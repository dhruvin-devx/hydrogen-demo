import type {Route} from './+types/authorize';

export async function loader({context}: Route.LoaderArgs) {
  return context.customerAccount.authorize();
}
