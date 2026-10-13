@IsTest
private class AssortmentBuilderControllerTest {
  // ConnectApi CommerceStorePricing is not callable in an Apex test context, so the
  // controller short-circuits via Test.isRunningTest(). These tests pin the input-guard
  // + test-context behavior; the live pricing path is proven against the org
  // (docs/API-NOTES.md) and verified in a browser. Add-to-cart is handled entirely on
  // the client via commerce/cartApi (binds to the active cart) and has no Apex path.

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
}
