import { LightningElement, api, wire } from "lwc";
import { CurrentPageReference } from "lightning/navigation";
import { ProductAdapter } from "commerce/productApi";
import { SessionContextAdapter, AppContextAdapter } from "commerce/contextApi";
import { addItemToCart, refreshCartSummary } from "commerce/cartApi";
import Toast from "lightning/toast";
import getVariantPrices from "@salesforce/apex/AssortmentBuilderController.getVariantPrices";
import {
  normalizeAxes,
  buildVariantMap,
  resolveVariantId,
  computeRunningTotal,
  coerceQty,
} from "./assortmentModel";

/**
 * Assortment Builder — a quantity matrix for a variation product on a PDP.
 *
 * Prices are fetched ONCE for every mapped child (buyer-aware flat unit price; the
 * ConnectApi pricing has no quantity field — ruling R1), so changing a quantity only
 * recomputes the running total on the client, never re-hits the server. Add to Cart
 * loops the storefront-native commerce/cartApi add once per non-zero cell (R2 — no bulk
 * add API); the client module binds to the shopper's ACTIVE cart, so items land in the
 * existing cart rather than attempting to create a new one. Non-atomic: a line that
 * fails leaves the earlier lines in the cart and is reported, not rolled back.
 * Quantity inputs honor the product's purchaseQuantityRule when present (R4).
 */
export default class AssortmentBuilder extends LightningElement {
  @api heading = "Build Your Order";
  @api productId; // optional admin override of the PDP record id
  @api swapAxes = false;
  // LWC forbids a public Boolean defaulting to true, so expose the inverse and
  // derive showClear from it — Clear still shows by default (hideClear = false).
  @api hideClear = false;

  _resolvedProductId;
  axes = [];
  variantMap = {};
  prices = {}; // childId -> { unitPrice, currencyIsoCode }
  quantities = {}; // childId -> number
  qtyRule = null; // purchaseQuantityRule or null
  currencyIso = "USD";
  _busy = false;
  _variantIds = []; // mapped child ids awaiting a price fetch
  _pricedCtxKey = null; // webstoreId|effectiveAccountId the current prices were fetched for
  _sessionEmitted = false;
  _appEmitted = false;

  @wire(CurrentPageReference)
  wiredPage(ref) {
    const fromPage = ref && ref.attributes && ref.attributes.recordId;
    this._resolvedProductId = this.productId || fromPage;
  }

  // Function wires (not property wires): we must react when the buyer context
  // resolves, since pricing is buyer-aware and the wires can emit after the product
  // loads. Pricing is held until BOTH have emitted, then refetched if the context
  // (store or effective account) changes.
  @wire(SessionContextAdapter)
  wiredSession(result) {
    this.session = result;
    this._sessionEmitted = true;
    this.tryLoadPrices();
  }

  @wire(AppContextAdapter)
  wiredApp(result) {
    this.appCtx = result;
    this._appEmitted = true;
    this.tryLoadPrices();
  }

  @wire(ProductAdapter, { productId: "$_resolvedProductId" })
  wiredProduct({ data, error }) {
    if (data) {
      this.applyVariation(this.extractVariationInfo(data));
    } else if (error) {
      // eslint-disable-next-line no-console
      console.warn("assortmentBuilder product wire error", error);
    }
  }

  // Defensive extraction — tolerant of field-name casing differences (see docs/API-NOTES.md).
  extractVariationInfo(data) {
    const vi = data.variationInfo || (data.fields && data.fields.variationInfo) || {};
    return {
      variationAttributeInfo:
        vi.variationAttributeInfo || vi.variationAttributesInfo || vi.attributeInfo || {},
      attributesToProductMappings:
        vi.attributesToProductMappings || vi.productMappings || [],
      purchaseQuantityRule: data.purchaseQuantityRule || vi.purchaseQuantityRule || null,
    };
  }

  @api
  applyVariationForTest(variationInfo) {
    this.applyVariation(variationInfo);
  }

  applyVariation(variationInfo) {
    this.axes = normalizeAxes(
      variationInfo.variationAttributeInfo,
      variationInfo.attributesToProductMappings
    );
    // Key the variant map over the SAME capped axis set the grid resolves against
    // (displayAxes), so a 3+ axis product collapses to an orderable 2-axis grid
    // instead of an all-unavailable one.
    this.variantMap = buildVariantMap(
      this.displayAxes,
      variationInfo.attributesToProductMappings
    );
    this.qtyRule = variationInfo.purchaseQuantityRule || null;
    // Price every mapped child (buyer-aware), but defer until the buyer context is ready.
    this._variantIds = Array.from(new Set(Object.values(this.variantMap)));
    this.tryLoadPrices();
  }

  // The axes actually laid out on the grid, capped at two (X then Y) in display order.
  // For 1-2 axis products this is just `axes`; for 3+ it is the first two, honoring swap.
  get displayAxes() {
    if (this.axes.length <= 2) {
      return this.axes;
    }
    const first = this.axes[0];
    const second = this.axes[1];
    return this.swapAxes ? [second, first] : [first, second];
  }

  get effectiveAccountId() {
    return (this.session && this.session.data && this.session.data.effectiveAccountId) || null;
  }

  get webstoreId() {
    return (this.appCtx && this.appCtx.data && this.appCtx.data.webstoreId) || null;
  }

  get showClear() {
    return !this.hideClear;
  }

  get hasGrid() {
    return this.axes.length >= 1;
  }

  get tooManyAxes() {
    return this.axes.length >= 3;
  }

  get xAxis() {
    if (this.axes.length === 0) {
      return { apiName: null, values: [] };
    }
    return this.swapAxes && this.axes.length > 1 ? this.axes[1] : this.axes[0];
  }

  get yAxis() {
    if (this.axes.length <= 1) {
      return { apiName: null, values: [{ value: "__single", label: "" }] };
    }
    return this.swapAxes ? this.axes[0] : this.axes[1];
  }

  get rows() {
    const xAxis = this.xAxis;
    const yAxis = this.yAxis;
    return yAxis.values.map((rv) => ({
      key: rv.value,
      label: rv.label,
      cells: xAxis.values.map((cv) => {
        const valuesByApi = { [xAxis.apiName]: cv.value };
        if (yAxis.apiName) {
          valuesByApi[yAxis.apiName] = rv.value;
        }
        const childId = resolveVariantId(this.variantMap, this.displayAxes, valuesByApi);
        const price = childId && this.prices[childId];
        return {
          key: `${rv.value}|${cv.value}`,
          childId,
          available: !!childId,
          qty: (childId && this.quantities[childId]) || 0,
          priceLabel: price ? this.formatCurrency(price.unitPrice) : "",
        };
      }),
    }));
  }

  get runningTotalLabel() {
    const lines = Object.keys(this.quantities).map((id) => ({
      qty: this.quantities[id],
      unitPrice: this.prices[id] ? this.prices[id].unitPrice : null,
    }));
    return this.formatCurrency(computeRunningTotal(lines));
  }

  get addDisabled() {
    return this._busy || !Object.values(this.quantities).some((q) => q > 0);
  }

  formatCurrency(amount) {
    const n = Number(amount);
    if (amount == null || Number.isNaN(n)) {
      return "";
    }
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: this.currencyIso || "USD",
    }).format(n);
  }

  handleQtyChange(event) {
    const childId = event.target.dataset.childId;
    const next = coerceQty(event.target.value, this.qtyRule);
    this.quantities = { ...this.quantities, [childId]: next };
  }

  // Fetch prices once the buyer context is known, and again whenever it changes.
  // Gating on both wires avoids pricing against a null (guest) account on first render.
  tryLoadPrices() {
    if (!this._sessionEmitted || !this._appEmitted || !this._variantIds.length) {
      return;
    }
    const ctxKey = `${this.webstoreId}|${this.effectiveAccountId}`;
    if (ctxKey === this._pricedCtxKey) {
      return;
    }
    this._pricedCtxKey = ctxKey;
    this.loadPrices(this._variantIds);
  }

  loadPrices(productIds) {
    getVariantPrices({
      webstoreId: this.webstoreId,
      effectiveAccountId: this.effectiveAccountId,
      productIds,
    })
      .then((results) => {
        const next = { ...this.prices };
        (results || []).forEach((r) => {
          next[r.productId] = { unitPrice: r.unitPrice, currencyIsoCode: r.currencyIsoCode };
          if (r.currencyIsoCode) {
            this.currencyIso = r.currencyIsoCode;
          }
        });
        this.prices = next;
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.warn("assortmentBuilder price load failed", e);
      });
  }

  handleAddToCart() {
    if (this.addDisabled) {
      return;
    }
    const items = Object.keys(this.quantities)
      .filter((id) => this.quantities[id] > 0)
      .map((id) => ({ productId: id, quantity: this.quantities[id] }));
    const requested = items.length;
    this._busy = true;

    // Loop the storefront-native add once per non-zero cell, sequentially so the
    // concurrent writes don't race on the same active cart. Each call binds to the
    // shopper's active cart (no cart creation), fixing the "new cart can be created
    // only when there are no current carts" error the server-side path hit.
    let added = 0;
    let firstError = null;
    const chain = items.reduce(
      (p, it) =>
        p.then(() =>
          addItemToCart(it.productId, it.quantity).then(
            () => {
              added += 1;
            },
            (e) => {
              if (!firstError) {
                firstError = this.errorMessage(e);
              }
            }
          )
        ),
      Promise.resolve()
    );

    chain
      .then(() => {
        this._busy = false;
        refreshCartSummary();
        if (added >= requested) {
          // full success — safe to clear the grid
          Toast.show(
            { label: "Added to cart", message: `${added} item(s) added.`, variant: "success" },
            this
          );
          this.handleClear();
        } else if (added > 0) {
          // partial — keep quantities so the buyer can retry the failed lines
          Toast.show(
            {
              label: "Partially added",
              message: `${added} of ${requested} item(s) added.${firstError ? ` ${firstError}` : ""}`,
              variant: "warning",
            },
            this
          );
        } else {
          // nothing added — surface the error, keep quantities
          Toast.show(
            {
              label: "Couldn't add to cart",
              message: firstError || "No items were added. Please try again.",
              variant: "error",
            },
            this
          );
        }
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.error("assortmentBuilder add to cart failed", e);
        this._busy = false;
        Toast.show(
          { label: "Couldn't add to cart", message: "Please try again.", variant: "error" },
          this
        );
      });
  }

  // Best-effort human-readable message out of a commerce/cartApi rejection.
  errorMessage(e) {
    if (!e) {
      return "";
    }
    if (typeof e === "string") {
      return e;
    }
    return (e.body && e.body.message) || e.message || "";
  }

  handleClear() {
    this.quantities = {};
  }
}
