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
    el.applyVariationForTest(VARIATION);
    return flush().then(() => {
      expect(getVariantPrices).toHaveBeenCalledTimes(1);
      const arg = getVariantPrices.mock.calls[0][0];
      expect(arg.productIds.sort()).toEqual(["01tMEDBLK", "01tSMLBLK", "01tSMLNVY"]);
      expect(arg).not.toHaveProperty("items");
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
});
