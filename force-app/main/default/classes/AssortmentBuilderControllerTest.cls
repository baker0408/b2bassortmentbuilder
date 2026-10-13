@IsTest
private class AssortmentBuilderControllerTest {
  // ConnectApi CommerceStorePricing / CommerceCart are not callable in an Apex test
  // context, so the controller short-circuits via Test.isRunningTest(). These tests
  // pin the input-guard + test-context behavior; the live ConnectApi paths are proven
  // against the org (docs/API-NOTES.md) and verified in a browser.

  @IsTest
  static void getVariantPricesEmptyReturnsEmpty() {
    Test.startTest();
    List<AssortmentBuilderController.PriceResult> res =
      AssortmentBuilderController.getVariantPrices('ws', 'acct', new List<String>());
    Test.stopTest();
    System.assertEquals(0, res.size(), 'empty productIds -> no results');
  }

  @IsTest
  static void getVariantPricesInTestContextShortCircuits() {
    Test.startTest();
    List<AssortmentBuilderController.PriceResult> res =
      AssortmentBuilderController.getVariantPrices('ws', 'acct',
        new List<String>{ '01tA', '01tB' });
    Test.stopTest();
    System.assertEquals(0, res.size(), 'ConnectApi pricing is not invoked in test context');
  }

  @IsTest
  static void addToCartEmptyReturnsZero() {
    Test.startTest();
    AssortmentBuilderController.AddResult r =
      AssortmentBuilderController.addToCart('ws', 'acct',
        new List<AssortmentBuilderController.CartLine>());
    Test.stopTest();
    System.assertEquals(0, r.itemsAdded, 'empty cart lines -> nothing added');
  }

  @IsTest
  static void addToCartInTestContextShortCircuits() {
    AssortmentBuilderController.CartLine line = new AssortmentBuilderController.CartLine();
    line.productId = '01tA';
    line.quantity = 3;
    Test.startTest();
    AssortmentBuilderController.AddResult r =
      AssortmentBuilderController.addToCart('ws', 'acct',
        new List<AssortmentBuilderController.CartLine>{ line });
    Test.stopTest();
    System.assertEquals(0, r.itemsAdded, 'ConnectApi cart is not invoked in test context');
  }
}
