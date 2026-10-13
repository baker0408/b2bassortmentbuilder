import { createElement } from "lwc";
import AssortmentBuilder from "c/assortmentBuilder";

jest.mock(
  "@salesforce/apex/AssortmentBuilderController.getVariantPrices",
  () => ({ default: jest.fn(() => Promise.resolve([])) }),
  { virtual: true }
);
jest.mock(
  "@salesforce/apex/AssortmentBuilderController.addToCart",
  () => ({ default: jest.fn(() => Promise.resolve({ itemsAdded: 0 })) }),
  { virtual: true }
);
jest.mock("commerce/cartApi", () => ({ refreshCartSummary: jest.fn() }), { virtual: true });
jest.mock(
  "commerce/contextApi",
  () => {
    const { createTestWireAdapter } = require("@salesforce/wire-service-jest-util");
    return {
      SessionContextAdapter: createTestWireAdapter(jest.fn()),
      AppContextAdapter: createTestWireAdapter(jest.fn()),
    };
  },
  { virtual: true }
);
jest.mock(
  "commerce/productApi",
  () => {
    const { createTestWireAdapter } = require("@salesforce/wire-service-jest-util");
    return { ProductAdapter: createTestWireAdapter(jest.fn()) };
  },
  { virtual: true }
);
jest.mock(
  "lightning/navigation",
  () => {
    const { createTestWireAdapter } = require("@salesforce/wire-service-jest-util");
    return { CurrentPageReference: createTestWireAdapter(jest.fn()) };
  },
  { virtual: true }
);
jest.mock(
  "lightning/toast",
  () => ({ __esModule: true, default: { show: jest.fn() } }),
  { virtual: true }
);

import getVariantPrices from "@salesforce/apex/AssortmentBuilderController.getVariantPrices";
import addToCart from "@salesforce/apex/AssortmentBuilderController.addToCart";
import Toast from "lightning/toast";
import { SessionContextAdapter, AppContextAdapter } from "commerce/contextApi";

// Emit the two buyer-context wires so pricing is allowed to fire (prices are gated
// until both context adapters have delivered). The wire value carries a `.data`
// envelope, matching the live commerce/contextApi shape the component reads.
function emitContext({ webstoreId = "ws", effectiveAccountId = "acct" } = {}) {
  AppContextAdapter.emit({ data: { webstoreId } });
  SessionContextAdapter.emit({ data: { effectiveAccountId } });
}

// Realistic live shapes (docs/API-NOTES.md): variationAttributeInfo keyed by apiName
// with NO sequence; sequence lives on the mappings' selectedAttributes (Sizes=0, Colors=1).
const VARIATION = {
  variationAttributeInfo: {
    Clothing_Sizes__c: {
      apiName: "Clothing_Sizes__c",
      label: "Size",
      availableValues: ["Small", "Medium"],
    },
    Clothing_Colors__c: {
      apiName: "Clothing_Colors__c",
      label: "Color",
      availableValues: ["Black", "Navy"],
    },
  },
  attributesToProductMappings: [
    {
      productId: "01tSMLBLK",
      selectedAttributes: [
        { apiName: "Clothing_Sizes__c", sequence: 0, value: "Small" },
        { apiName: "Clothing_Colors__c", sequence: 1, value: "Black" },
      ],
    },
    {
      productId: "01tMEDBLK",
      selectedAttributes: [
        { apiName: "Clothing_Sizes__c", sequence: 0, value: "Medium" },
        { apiName: "Clothing_Colors__c", sequence: 1, value: "Black" },
      ],
    },
    {
      productId: "01tSMLNVY",
      selectedAttributes: [
        { apiName: "Clothing_Sizes__c", sequence: 0, value: "Small" },
        { apiName: "Clothing_Colors__c", sequence: 1, value: "Navy" },
      ],
    },
    // Note: Medium/Navy intentionally unmapped -> that cell is unavailable.
  ],
  purchaseQuantityRule: null,
};

function flush() {
  return Promise.resolve();
}

describe("c-assortment-builder", () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
  });

  it("renders the heading", () => {
    const el = createElement("c-assortment-builder", { is: AssortmentBuilder });
    el.heading = "Build Your Order";
    document.body.appendChild(el);
    expect(el.shadowRoot.querySelector(".ab-heading").textContent).toBe("Build Your Order");
  });

  it("builds grid columns (sizes) and rows (colors) from variation data, with an unavailable cell", () => {
    const el = createElement("c-assortment-builder", { is: AssortmentBuilder });
    document.body.appendChild(el);
    el.applyVariationForTest(VARIATION);
    return flush().then(() => {
      const cols = el.shadowRoot.querySelectorAll("th.ab-col");
      const inputs = el.shadowRoot.querySelectorAll("input.ab-qty");
      const unavailable = el.shadowRoot.querySelectorAll(".ab-unavailable");
      expect(cols.length).toBe(2); // Small, Medium (axis sequence 0)
      expect(inputs.length).toBe(3); // 3 mapped children
      expect(unavailable.length).toBe(1); // Medium/Navy unmapped
    });
  });

  it("fetches prices once for all mapped variants on load (productIds, no quantity)", () => {
    const el = createElement("c-assortment-builder", { is: AssortmentBuilder });
    document.body.appendChild(el);
    emitContext();
    el.applyVariationForTest(VARIATION);
    return flush().then(() => {
      expect(getVariantPrices).toHaveBeenCalledTimes(1);
      const arg = getVariantPrices.mock.calls[0][0];
      expect(arg.productIds.sort()).toEqual(["01tMEDBLK", "01tSMLBLK", "01tSMLNVY"]);
      expect(arg).not.toHaveProperty("items");
    });
  });

  // I2: do not price against guest/null context. Hold the fetch until BOTH context
  // wires have delivered, then fire once; refetch when the buyer context changes.
  it("does not fetch prices until both context wires have emitted", () => {
    const el = createElement("c-assortment-builder", { is: AssortmentBuilder });
    document.body.appendChild(el);
    el.applyVariationForTest(VARIATION);
    return flush()
      .then(() => {
        expect(getVariantPrices).not.toHaveBeenCalled(); // no context yet
        AppContextAdapter.emit({ data: { webstoreId: "ws" } });
        return flush();
      })
      .then(() => {
        expect(getVariantPrices).not.toHaveBeenCalled(); // only one wire so far
        SessionContextAdapter.emit({ data: { effectiveAccountId: "acct" } });
        return flush();
      })
      .then(() => {
        expect(getVariantPrices).toHaveBeenCalledTimes(1);
        expect(getVariantPrices.mock.calls[0][0].effectiveAccountId).toBe("acct");
      });
  });

  it("refetches prices when the effective account changes", () => {
    const el = createElement("c-assortment-builder", { is: AssortmentBuilder });
    document.body.appendChild(el);
    emitContext({ effectiveAccountId: "guest" });
    el.applyVariationForTest(VARIATION);
    return flush()
      .then(() => {
        expect(getVariantPrices).toHaveBeenCalledTimes(1);
        expect(getVariantPrices.mock.calls[0][0].effectiveAccountId).toBe("guest");
        SessionContextAdapter.emit({ data: { effectiveAccountId: "acct-123" } });
        return flush();
      })
      .then(() => {
        expect(getVariantPrices).toHaveBeenCalledTimes(2);
        expect(getVariantPrices.mock.calls[1][0].effectiveAccountId).toBe("acct-123");
      });
  });

  it("disables Add to Cart until at least one quantity is entered", () => {
    const el = createElement("c-assortment-builder", { is: AssortmentBuilder });
    document.body.appendChild(el);
    el.applyVariationForTest(VARIATION);
    return flush()
      .then(() => {
        const btn = el.shadowRoot.querySelector(".ab-add");
        expect(btn.disabled).toBe(true);
        const input = el.shadowRoot.querySelector("input.ab-qty");
        input.value = "2";
        input.dispatchEvent(new CustomEvent("change"));
        return flush();
      })
      .then(() => {
        expect(el.shadowRoot.querySelector(".ab-add").disabled).toBe(false);
      });
  });

  it("adds only the non-zero variants to the cart in one call", () => {
    const el = createElement("c-assortment-builder", { is: AssortmentBuilder });
    document.body.appendChild(el);
    el.applyVariationForTest(VARIATION);
    return flush()
      .then(() => {
        const input = el.shadowRoot.querySelector('input.ab-qty[data-child-id="01tSMLBLK"]');
        input.value = "3";
        input.dispatchEvent(new CustomEvent("change"));
        return flush();
      })
      .then(() => {
        el.shadowRoot.querySelector(".ab-add").click();
        return flush();
      })
      .then(() => {
        expect(addToCart).toHaveBeenCalledTimes(1);
        const arg = addToCart.mock.calls[0][0];
        expect(arg.items).toEqual([{ productId: "01tSMLBLK", quantity: 3 }]);
      });
  });

  // C1: Apex addToCart swallows per-line exceptions and resolves normally, so the LWC
  // .then always runs. A result of itemsAdded:0 is a FAILURE, not a success — it must
  // surface the error and keep the buyer's quantities, not toast success and clear.
  it("reports an error and retains quantities when nothing was added", () => {
    addToCart.mockResolvedValueOnce({ itemsAdded: 0, cartId: null, error: "Out of stock" });
    const el = createElement("c-assortment-builder", { is: AssortmentBuilder });
    document.body.appendChild(el);
    el.applyVariationForTest(VARIATION);
    return flush()
      .then(() => {
        const input = el.shadowRoot.querySelector('input.ab-qty[data-child-id="01tSMLBLK"]');
        input.value = "3";
        input.dispatchEvent(new CustomEvent("change"));
        return flush();
      })
      .then(() => {
        el.shadowRoot.querySelector(".ab-add").click();
        return flush();
      })
      .then(() => {
        expect(Toast.show).toHaveBeenCalledTimes(1);
        expect(Toast.show.mock.calls[0][0].variant).toBe("error");
        expect(Toast.show.mock.calls[0][0].message).toContain("Out of stock");
        // quantities retained -> the cell still holds 3 and Add stays enabled
        const input = el.shadowRoot.querySelector('input.ab-qty[data-child-id="01tSMLBLK"]');
        expect(Number(input.value)).toBe(3);
        expect(el.shadowRoot.querySelector(".ab-add").disabled).toBe(false);
      });
  });

  it("reports a partial-success warning and retains quantities when some lines fail", () => {
    addToCart.mockResolvedValueOnce({ itemsAdded: 1, cartId: "cart1", error: "1 line failed" });
    const el = createElement("c-assortment-builder", { is: AssortmentBuilder });
    document.body.appendChild(el);
    el.applyVariationForTest(VARIATION);
    return flush()
      .then(() => {
        const a = el.shadowRoot.querySelector('input.ab-qty[data-child-id="01tSMLBLK"]');
        a.value = "2";
        a.dispatchEvent(new CustomEvent("change"));
        const b = el.shadowRoot.querySelector('input.ab-qty[data-child-id="01tMEDBLK"]');
        b.value = "4";
        b.dispatchEvent(new CustomEvent("change"));
        return flush();
      })
      .then(() => {
        el.shadowRoot.querySelector(".ab-add").click();
        return flush();
      })
      .then(() => {
        expect(Toast.show).toHaveBeenCalledTimes(1);
        expect(Toast.show.mock.calls[0][0].variant).toBe("warning");
        // quantities retained so the buyer can retry the failed line
        expect(el.shadowRoot.querySelector(".ab-add").disabled).toBe(false);
      });
  });

  it("toasts success and clears the grid only when all lines are added", () => {
    addToCart.mockResolvedValueOnce({ itemsAdded: 1, cartId: "cart1", error: null });
    const el = createElement("c-assortment-builder", { is: AssortmentBuilder });
    document.body.appendChild(el);
    el.applyVariationForTest(VARIATION);
    return flush()
      .then(() => {
        const input = el.shadowRoot.querySelector('input.ab-qty[data-child-id="01tSMLBLK"]');
        input.value = "1";
        input.dispatchEvent(new CustomEvent("change"));
        return flush();
      })
      .then(() => {
        el.shadowRoot.querySelector(".ab-add").click();
        return flush();
      })
      .then(() => {
        expect(Toast.show.mock.calls[0][0].variant).toBe("success");
        expect(el.shadowRoot.querySelector(".ab-add").disabled).toBe(true); // cleared
      });
  });

  // I1: a product with 3+ variation axes must still render an orderable grid of its
  // first two axes — not an all-unavailable grid. The grid lookup key and the variant
  // map must be built over the SAME (capped) axis set.
  it("renders orderable cells for a product with three variation axes", () => {
    const THREE_AXIS = {
      variationAttributeInfo: {
        Clothing_Sizes__c: { apiName: "Clothing_Sizes__c", label: "Size", availableValues: ["Small", "Medium"] },
        Clothing_Colors__c: { apiName: "Clothing_Colors__c", label: "Color", availableValues: ["Black", "Navy"] },
        Sleeve__c: { apiName: "Sleeve__c", label: "Sleeve", availableValues: ["Short", "Long"] },
      },
      attributesToProductMappings: [
        {
          productId: "01tA",
          selectedAttributes: [
            { apiName: "Clothing_Sizes__c", sequence: 0, value: "Small" },
            { apiName: "Clothing_Colors__c", sequence: 1, value: "Black" },
            { apiName: "Sleeve__c", sequence: 2, value: "Short" },
          ],
        },
        {
          productId: "01tB",
          selectedAttributes: [
            { apiName: "Clothing_Sizes__c", sequence: 0, value: "Medium" },
            { apiName: "Clothing_Colors__c", sequence: 1, value: "Navy" },
            { apiName: "Sleeve__c", sequence: 2, value: "Short" },
          ],
        },
      ],
      purchaseQuantityRule: null,
    };
    const el = createElement("c-assortment-builder", { is: AssortmentBuilder });
    document.body.appendChild(el);
    el.applyVariationForTest(THREE_AXIS);
    return flush().then(() => {
      const inputs = el.shadowRoot.querySelectorAll("input.ab-qty");
      expect(inputs.length).toBeGreaterThan(0); // not an all-dead grid
    });
  });
});
