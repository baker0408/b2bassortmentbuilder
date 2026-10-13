# Live API shapes — confirmed against `acgbrands` (v67.0, 2026-10-13)

Confirmed by anonymous-Apex compile probes and a live Connect REST product fetch of the
THAW vest variation parent `01tjV000001aMXpQAM`. These supersede the design-time assumptions
in the spec/plan where they differ.

## Product / variation shape (`ProductAdapter` / Connect REST product)

`GET /commerce/webstores/{id}/products/{productId}` top-level keys include:
`productClass`, `variationInfo`, `variationAttributeSet`, `purchaseQuantityRule`, `fields`,
`defaultImage`, `mediaGroups`.

- `productClass` = `"VariationParent"` for the vest parent.
- `variationInfo.variationAttributeInfo` — **object keyed by field apiName**
  (`Clothing_Sizes__c`, `Clothing_Colors__c`). Each entry:
  `{ apiName, label, availableValues: string[], allowableValues: string[],
     options: [{apiName,label,colorHexCode,variantAvailable}], fieldEnumOrId, objectName }`.
  **No `sequence` on these entries** — use `availableValues` for the orderable value list
  (XS/XXL are excluded there; they are not variant-available).
- `variationInfo.attributesToProductMappings` — **array**, one row per orderable child
  (12 for the vest). Each: `{ productId, canonicalKey ("Medium_Black"), mediaItems,
     selectedAttributes: [{ apiName, label, sequence, value }] }`.
  **`sequence` lives here** (Sizes=0, Colors=1) — this is the authoritative axis order.
- `purchaseQuantityRule` — product-level quantity rule (min/max/increment) or **null**.
  Null on the vest, so no min/max/increment constraint for this demo. Honor it when present.

## Pricing — `ConnectApi.CommerceStorePricing.getProductPrices`

`getProductPrices(String webstoreId, String effectiveAccountId, ConnectApi.PricingInput)`
→ `ConnectApi.PricingResult`.

- `PricingInput.pricingLineItems : List<ConnectApi.PricingLineItemInput>`.
- `PricingLineItemInput` — **only `productId`. There is NO `quantity` field.** (Confirmed:
  `Variable does not exist: quantity`.)
- `PricingResult`: `currencyIsoCode : String`, `pricingLineItemResults : List<PricingResultLineItem>`.
- `PricingResultLineItem`: `productId : String`, `unitPrice : String`, `listPrice : String`,
  `success : Boolean`, `error : ConnectApi.ErrorResponse` (`.message`). Prices are **Strings**.

**Consequence:** pricing is not quantity-aware via this API, and ACG has no CommercePricing
extension, so a quantity-break price cannot differ from the flat buyer-aware unit price.
→ Fetch flat buyer-aware unit price per child (reflects buyer/entitlement price adjustments);
compute the running total client-side as Σ(unitPrice × qty). Promotions remain cart-time.

## Cart — `ConnectApi.CommerceCart`

- **No bulk-add input type exists** in this org's v67 ConnectApi. Tested and all invalid:
  `BatchAddCartItemsInput`, `BatchAddToCartLineItemInput`, `BatchCartItemInput`,
  `CartItemCollectionInput`, `AddCartItemsInput`.
- Confirmed path is **singular**:
  `ConnectApi.CommerceCart.addItemToCart(String webstoreId, String effectiveAccountId,
  String activeCartOrId, ConnectApi.CartItemInput)` → `ConnectApi.CartItem` (`.cartId`).
- `CartItemInput`: `productId : String`, `quantity : String`, `type : ConnectApi.CartItemType`
  (`ConnectApi.CartItemType.Product`).
- `activeCartOrId` = `'active'`.

**⚠️ The server-side path does NOT bind to the existing cart.** Calling
`ConnectApi.CommerceCart.addItemToCart(..., 'active', ...)` from Apex adds to an empty cart
but, when the shopper already has a cart, throws *"A new cart can be created only when there
are no current carts"* — the `'active'` keyword resolves to "create a new cart" rather than
the shopper's current one. Observed live on the vest PDP with a non-empty cart.

**Resolution — add on the client, not in Apex.** The storefront-native `commerce/cartApi`
`addItemToCart(productId, quantity)` (Promise) binds to the shopper's active cart the same
way the OOTB Add-to-Cart button and the in-repo `epRecommendedProductCard` do. The component
loops it once per non-zero cell (sequentially, to avoid racing the single cart). There is no
Apex cart method — the controller is pricing-only.

## PDP product context

LWR PDP is a `standard__recordPage`; `CurrentPageReference.attributes.recordId` is the
Product2 id (used zero-config). Confirmed by the in-repo card's `standard__recordPage`
navigation to `Product2`.

## Rulings applied downstream

- R1 — `getVariantPrices(webstoreId, effectiveAccountId, List<String> productIds)` (no qty);
  total computed client-side. Honors buyer price adjustments; quantity-break + promotions
  documented as not-applicable / cart-time.
- R2 — add-to-cart is client-side via `commerce/cartApi.addItemToCart(productId, quantity)`,
  looped once per non-zero cell (binds to the active cart). Non-atomic; the component counts
  successes/failures and keeps quantities on anything short of full success. No Apex cart path.
- R3 — `normalizeAxes(variationAttributeInfo, mappings)`: axis order from the mappings'
  `selectedAttributes[].sequence`; value lists from `availableValues`.
- R4 — honor top-level `purchaseQuantityRule` (min/max/increment) on the qty inputs when present.
