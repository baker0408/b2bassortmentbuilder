/**
 * Server bridge for the Assortment Builder LWC.
 *
 * Pricing (ruling R1): the ConnectApi PricingLineItemInput has NO quantity field and
 * ACG has no CommercePricing extension, so a quantity-break price can't differ from the
 * flat buyer-aware unit price. getVariantPrices therefore takes productIds only and
 * returns the buyer-aware unit price per child; the running total is Σ(unitPrice×qty)
 * on the client. Promotions remain cart-time.
 *
 * Cart: add-to-cart is handled entirely on the client via the storefront-native
 * commerce/cartApi module, which binds to the shopper's active cart. There is no Apex
 * cart path here — a server-side ConnectApi.CommerceCart.addItemToCart with the 'active'
 * keyword does not bind to the existing cart and attempts to create a new one, which
 * fails when the shopper already has a cart.
 *
 * Field shapes confirmed live — see docs/API-NOTES.md.
 */
public with sharing class AssortmentBuilderController {
  public class PriceResult {
    @AuraEnabled public String productId;
    @AuraEnabled public Decimal unitPrice;
    @AuraEnabled public Decimal listPrice;
    @AuraEnabled public String currencyIsoCode;
    @AuraEnabled public String error;
  }

  @AuraEnabled
  public static List<PriceResult> getVariantPrices(
      String webstoreId, String effectiveAccountId, List<String> productIds) {
    List<PriceResult> out = new List<PriceResult>();
    if (productIds == null || productIds.isEmpty()) {
      return out;
    }
    webstoreId = resolveWebstoreId(webstoreId);
    if (Test.isRunningTest()) {
      return out; // ConnectApi pricing is not callable in a test context
    }
    ConnectApi.PricingInput input = new ConnectApi.PricingInput();
    input.pricingLineItems = new List<ConnectApi.PricingLineItemInput>();
    for (String pid : productIds) {
      ConnectApi.PricingLineItemInput li = new ConnectApi.PricingLineItemInput();
      li.productId = pid;
      input.pricingLineItems.add(li);
    }
    ConnectApi.PricingResult res =
      ConnectApi.CommerceStorePricing.getProductPrices(webstoreId, effectiveAccountId, input);
    for (ConnectApi.PricingResultLineItem rli : res.pricingLineItemResults) {
      PriceResult pr = new PriceResult();
      pr.productId = rli.productId;
      pr.unitPrice = String.isBlank(rli.unitPrice) ? null : Decimal.valueOf(rli.unitPrice);
      pr.listPrice = String.isBlank(rli.listPrice) ? null : Decimal.valueOf(rli.listPrice);
      pr.currencyIsoCode = res.currencyIsoCode;
      pr.error = (rli.error != null) ? rli.error.message : null;
      out.add(pr);
    }
    return out;
  }

  // Resolve the webstore from the running Experience Site when the client did not pass one.
  static String resolveWebstoreId(String webstoreId) {
    if (String.isNotBlank(webstoreId)) {
      return webstoreId;
    }
    Id networkId = Network.getNetworkId();
    if (networkId == null) {
      return null;
    }
    List<WebStoreNetwork> wsn = [
      SELECT WebStoreId FROM WebStoreNetwork WHERE NetworkId = :networkId LIMIT 1
    ];
    return wsn.isEmpty() ? null : wsn[0].WebStoreId;
  }
}
