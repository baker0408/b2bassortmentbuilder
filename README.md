# B2B Assortment Builder

A Salesforce **B2B Commerce (LWR)** Lightning Web Component that renders a
quantity **matrix** for a variation product — one axis of options across the top
(e.g. Size), the other down the side (e.g. Color) — with a per-cell quantity
input and unit price, a running total, and a single **Add to Cart** that adds
every non-zero cell at once.

Built for a product detail page (PDP). Namespace-free and org-agnostic, so it
can be deployed to any B2B Commerce org that has a variation product.

## What it does

- Reads the PDP product's `variationInfo` and lays out a grid of its orderable
  child variants. Combinations that aren't orderable render as unavailable (—).
- Shows the **buyer-aware unit price** for each variant and a live running total
  (Σ unit price × quantity) that updates as quantities change — no page reload,
  no server round-trip per keystroke.
- **Add to Cart** adds only the cells with a quantity ≥ 1, in one action, then
  refreshes the cart badge.

## Requirements

- Salesforce **B2B Commerce** on an **LWR** storefront.
- API version **67.0**.
- A **variation product** (a `VariationParent` with child `Variation`s and a
  variation attribute set) to place the component against.

## Install

Deploy the source to your org:

```bash
sf project deploy start --source-dir force-app --target-org <alias>
```

This deploys the `assortmentBuilder` LWC, the `AssortmentBuilderController` Apex
class (+ test), and the `Assortment_Builder` permission set.

## Assign access

Assign the bundled permission set to each user who will use (or build with) the
component — it grants the Apex controller access and read on the variation
attribute fields:

```bash
sf org assign permset --name Assortment_Builder --target-org <alias>
# for another user:
sf org assign permset --name Assortment_Builder --on-behalf-of "<User Name>" --target-org <alias>
```

> The permission set grants read FLS on `ProductAttribute.Clothing_Sizes__c` and
> `ProductAttribute.Clothing_Colors__c` (the stock SDO apparel axes). If your
> variation product uses different attribute fields, add their FLS to the
> permission set so the option selectors resolve.

## Place it on a PDP

Component placement is **UI-only** — it can't be deployed:

1. Open the store's **Experience Builder**.
2. Navigate to the **product detail page** of your variation product.
3. Drag the **Assortment Builder** component onto the page.
4. **Publish** the site (LWR won't serve the component until you republish).

By default the component uses the PDP's own product (`recordId`), so no
configuration is required for the standard case.

## Configuration properties

Set these in the Experience Builder property panel:

| Property | Type | Default | Purpose |
|---|---|---|---|
| `heading` | String | `Build Your Order` | Heading shown above the grid. |
| `productId` | String | *(empty)* | Optional override of the product id. Leave blank to use the PDP record. |
| `swapAxes` | Boolean | `false` | Swap which attribute is the X (columns) vs Y (rows) axis. |
| `hideClear` | Boolean | `false` | Hide the **Clear** button (shown by default). |

## Pricing & limitations

- **Unit price is buyer-aware.** It reflects the price book and any buyer- or
  entitlement-level price adjustments for the logged-in buyer, fetched once per
  load via `CommerceStorePricing.getProductPrices`.
- **Pricing is not quantity-aware** in this component. The ConnectApi pricing
  input carries no quantity, so a quantity-break (tier) price can only differ
  from the flat unit price if the org has a custom `CommercePricing` extension —
  which this component does not call. The running total is computed on the client
  as flat unit price × quantity.
- **Promotions apply at checkout, not in the grid.** Cart- and order-level
  promotions are evaluated by the cart/checkout, so the grid total is a
  pre-promotion estimate. The component says so inline.
- **Add to Cart is not atomic.** It loops the singular `addItemToCart` once per
  non-zero cell (there is no bulk-add API in v67 ConnectApi). If one line fails
  mid-loop, the lines added before it stay in the cart; the component reports how
  many were added and surfaces the first error.
- **Two axes maximum.** A product with three or more variation axes renders the
  first two and shows a note.

## Development

```bash
npm install
npm test        # Jest unit tests (sfdx-lwc-jest)
```

Tests cover the pure grid-logic model (`assortmentModel.js`) and the component
(grid dimensions, price-fetch shape, the add-disabled gate, and non-zero-only
add). The Apex controller's live ConnectApi paths are proven against a real org
(see `docs/API-NOTES.md`) and verified in a browser as a store buyer, since
ConnectApi pricing/cart aren't callable from an Apex test context.

## License

MIT — see [LICENSE](LICENSE).
