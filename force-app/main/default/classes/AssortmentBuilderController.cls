/**
 * Server bridge for the Assortment Builder LWC.
 *
 * Pricing (ruling R1): the ConnectApi PricingLineItemInput has NO quantity field and
 * ACG has no CommercePricing extension, so a quantity-break price can't differ from the
 * flat buyer-aware unit price. getVariantPrices therefore takes productIds only and
 * returns the buyer-aware unit price per child; the running total is Σ(unitPrice×qty)
 * on the client. Promotions remain cart-time.
 *
 * Cart (ruling R2): there is no bulk-add input type in this org's v67 ConnectApi, so
 * addToCart loops the singular CommerceCart.addItemToCart once per non-zero line in a
 * single server round-trip. Non-atomic: it reports how many lines were added and the
 * first error, and does not roll back a partial add.
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

  public class CartLine {
    @AuraEnabled public String productId { get; set; }
    @AuraEnabled public Integer quantity { get; set; }
  }

  public class AddResult {
    @AuraEnabled public Integer itemsAdded;
    @AuraEnabled public String cartId;
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

  @AuraEnabled
  public static AddResult addToCart(
      String webstoreId, String effectiveAccountId, List<CartLine> items) {
    AddResult result = new AddResult();
    result.itemsAdded = 0;
    if (items == null || items.isEmpty()) {
      return result;
    }
    webstoreId = resolveWebstoreId(webstoreId);
    if (Test.isRunningTest()) {
      return result; // ConnectApi cart is not callable in a test context
    }
    String cartId;
    Integer added = 0;
    for (CartLine line : items) {
      if (line.quantity == null || line.quantity < 1) {
        continue;
      }
      try {
        ConnectApi.CartItemInput ci = new ConnectApi.CartItemInput();
        ci.productId = line.productId;
        ci.quantity = String.valueOf(line.quantity);
        ci.type = ConnectApi.CartItemType.Product;
        ConnectApi.CartItem item =
          ConnectApi.CommerceCart.addItemToCart(webstoreId, effectiveAccountId, 'active', ci);
        if (item != null) {
          cartId = item.cartId;
        }
        added++;
      } catch (Exception e) {
        if (result.error == null) {
          result.error = e.getMessage();
        }
      }
    }
    result.itemsAdded = added;
    result.cartId = cartId;
    return result;
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
