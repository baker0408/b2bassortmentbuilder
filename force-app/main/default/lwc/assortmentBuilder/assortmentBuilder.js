import { LightningElement, api, wire } from "lwc";
import { CurrentPageReference } from "lightning/navigation";
import { ProductAdapter } from "commerce/productApi";
import { SessionContextAdapter, AppContextAdapter } from "commerce/contextApi";
import { refreshCartSummary } from "commerce/cartApi";
import Toast from "lightning/toast";
import getVariantPrices from "@salesforce/apex/AssortmentBuilderController.getVariantPrices";
import addToCart from "@salesforce/apex/AssortmentBuilderController.addToCart";
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
 * sends all non-zero cells in a single server call that loops the singular add (R2).
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

  @wire(CurrentPageReference)
  wiredPage(ref) {
    const fromPage = ref && ref.attributes && ref.attributes.recordId;
    this._resolvedProductId = this.productId || fromPage;
  }

  @wire(SessionContextAdapter)
  session;

  @wire(AppContextAdapter)
  appCtx;

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
    this.variantMap = buildVariantMap(this.axes, variationInfo.attributesToProductMappings);
    this.qtyRule = variationInfo.purchaseQuantityRule || null;
    const ids = Object.values(this.variantMap);
    if (ids.length) {
      this.loadPrices(ids);
    }
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
        const childId = resolveVariantId(this.variantMap, this.axes, valuesByApi);
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
    this._busy = true;
    addToCart({
      webstoreId: this.webstoreId,
      effectiveAccountId: this.effectiveAccountId,
      items,
    })
      .then((res) => {
        refreshCartSummary();
        Toast.show(
          {
            label: "Added to cart",
            message: `${res && res.itemsAdded ? res.itemsAdded : items.length} item(s) added.`,
            variant: "success",
          },
          this
        );
        this.handleClear();
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.error("assortmentBuilder add to cart failed", e);
        Toast.show(
          { label: "Couldn't add to cart", message: "Please try again.", variant: "error" },
          this
        );
      })
      .finally(() => {
        this._busy = false;
      });
  }

  handleClear() {
    this.quantities = {};
  }
}
