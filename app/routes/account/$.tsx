import {redirect} from 'react-router';
import type {Route} from './+types/$';

export async function loader({context}: Route.LoaderArgs) {
  await context.customerAccount.handleAuthStatus();
  return redirect('/account');
}
