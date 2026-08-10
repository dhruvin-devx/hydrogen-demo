import {useLoaderData, data, type HeadersFunction} from 'react-router';
import type {Route} from './+types/index';
import type {CartQueryDataReturn} from '@shopify/hydrogen';
import {CartForm} from '@shopify/hydrogen';
import {CartMain} from '~/components/CartMain';

export const meta: Route.MetaFunction = () => {
  return [{title: `Hydrogen | Cart`}];
};

export const headers: HeadersFunction = ({actionHeaders}) => actionHeaders;

export async function action({request, context}: Route.ActionArgs) {
  const {cart} = context;

  const formData = await request.formData();
  const {action, inputs} = CartForm.getFormInput(formData);

  if (!action) {
    throw new Error('No action provided');
  }

  // ─── DEMO ONLY: force a failure when a line update reaches quantity ≥ 10 ───
  // Skips the Shopify mutation and returns the CURRENT (unchanged) cart, so the
  // optimistic UI (which already jumped to 10) reverts to the last server-
  // confirmed quantity/price. Remove this block for production.
  // if (action === CartForm.ACTIONS.LinesUpdate) {
  //   const lines = inputs.lines ?? [];
  //   const reachesTen = lines.some((line) => (line.quantity ?? 0) >= 10);
  //   if (reachesTen) {
  //     return data(
  //       {
  //         cart: await cart.get(),
  //         errors: [
  //           {message: 'DEMO: simulated Shopify failure at quantity ≥ 10'},
  //         ],
  //         warnings: [],
  //         analytics: {cartId: null},
  //       },
  //       {status: 400},
  //     );
  //   }
  // }

  let status = 200;
  let result: CartQueryDataReturn;

  switch (action) {
    case CartForm.ACTIONS.LinesAdd:
      result = await cart.addLines(inputs.lines);
      break;
    case CartForm.ACTIONS.LinesUpdate:
      result = await cart.updateLines(inputs.lines);
      break;
    case CartForm.ACTIONS.LinesRemove:
      result = await cart.removeLines(inputs.lineIds);
      break;
    case CartForm.ACTIONS.DiscountCodesUpdate: {
      const formDiscountCode = inputs.discountCode;
      const discountCodes = (
        formDiscountCode ? [formDiscountCode] : []
      ) as string[];
      discountCodes.push(...inputs.discountCodes);
      result = await cart.updateDiscountCodes(discountCodes);
      break;
    }
    case CartForm.ACTIONS.GiftCardCodesAdd: {
      const formGiftCardCode = inputs.giftCardCode;
      const giftCardCodes = (
        formGiftCardCode ? [formGiftCardCode] : []
      ) as string[];
      result = await cart.addGiftCardCodes(giftCardCodes);
      break;
    }
    case CartForm.ACTIONS.GiftCardCodesRemove: {
      const appliedGiftCardIds = inputs.giftCardCodes as string[];
      result = await cart.removeGiftCardCodes(appliedGiftCardIds);
      break;
    }
    case CartForm.ACTIONS.BuyerIdentityUpdate: {
      result = await cart.updateBuyerIdentity({...inputs.buyerIdentity});
      break;
    }
    default:
      throw new Error(`${action} cart action is not defined`);
  }

  const cartId = result?.cart?.id;
  const headers = cartId ? cart.setCartId(result.cart.id) : new Headers();
  const {cart: cartResult, errors, warnings} = result;

  const redirectTo = formData.get('redirectTo') ?? null;
  if (typeof redirectTo === 'string') {
    status = 303;
    headers.set('Location', redirectTo);
  }

  return data(
    {
      cart: cartResult,
      errors,
      warnings,
      analytics: {cartId},
    },
    {status, headers},
  );
}

export async function loader({context}: Route.LoaderArgs) {
  const {cart} = context;
  return await cart.get();
}

export default function Cart() {
  const cart = useLoaderData<typeof loader>();

  return (
    <div className="cart">
      <h1>Cart</h1>
      <CartMain layout="page" cart={cart} />
    </div>
  );
}
