import type {LoaderFunctionArgs} from 'react-router';

// Dedicated cart resource route — called client-side by CartProvider.
// Keeping cart data out of page loaders lets pages carry public cache headers
// without leaking user-specific data into the cached response.
export async function loader({context}: LoaderFunctionArgs) {
  const cart = await context.cart.get();
  return Response.json(cart);
}
