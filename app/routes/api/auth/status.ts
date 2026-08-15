import type {LoaderFunctionArgs} from 'react-router';

export async function loader({context}: LoaderFunctionArgs) {
  const isLoggedIn = await context.customerAccount.isLoggedIn();
  return Response.json({isLoggedIn});
}
