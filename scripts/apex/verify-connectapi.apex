// Compile-only probe: proves the ConnectApi classes/inputs this feature relies on exist in v67.0.
ConnectApi.PricingInput pin = new ConnectApi.PricingInput();
pin.pricingLineItems = new List<ConnectApi.PricingLineItemInput>();
ConnectApi.PricingLineItemInput li = new ConnectApi.PricingLineItemInput();
li.productId = '01t000000000000AAA';
li.quantity = '1';
pin.pricingLineItems.add(li);
System.debug('PricingInput OK');

ConnectApi.BatchAddCartItemsInput batch = new ConnectApi.BatchAddCartItemsInput();
batch.cartItems = new List<ConnectApi.CartItemInput>();
ConnectApi.CartItemInput ci = new ConnectApi.CartItemInput();
ci.productId = '01t000000000000AAA';
ci.quantity = '1';
ci.type = ConnectApi.CartItemType.Product;
batch.cartItems.add(ci);
System.debug('BatchAddCartItemsInput OK');
