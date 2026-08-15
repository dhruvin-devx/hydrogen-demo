import {createContext, useContext, useEffect} from 'react';
import {useFetcher} from 'react-router';
import type {CartApiQueryFragment} from 'storefrontapi.generated';

const CartContext = createContext<CartApiQueryFragment | null>(null);

export function CartProvider({children}: {children: React.ReactNode}) {
  const fetcher = useFetcher<CartApiQueryFragment | null>();

  // Fetch cart client-side after hydration so it never appears in the
  // server-streamed response. This lets pages use public Oxygen cache headers
  // without leaking user-specific cart data into the cache.
  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data === undefined) {
      fetcher.load('/api/cart');
    }
  }, [fetcher]);

  return (
    <CartContext.Provider value={fetcher.data ?? null}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartApiQueryFragment | null {
  return useContext(CartContext);
}
