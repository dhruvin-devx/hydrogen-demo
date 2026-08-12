import {data, useLoaderData, useRevalidator} from 'react-router';
import type {LoaderFunctionArgs} from 'react-router';

type Customer = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  ordersCount: number;
  totalSpent: string;
  createdAt: string;
  verifiedEmail: boolean;
};

const CUSTOMERS_QUERY = `
  query GetCustomers {
    customers(first: 20, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          email
          firstName
          lastName
          numberOfOrders
          amountSpent { amount currencyCode }
          createdAt
          verifiedEmail
        }
      }
    }
  }
`;

export async function loader({context}: LoaderFunctionArgs) {
  const {SHOPIFY_ADMIN_API_TOKEN = '', PUBLIC_STORE_DOMAIN: storeDomain = ''} =
    context.env as Env;

  const res = await fetch(
    `https://${storeDomain}/admin/api/2024-01/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
      },
      body: JSON.stringify({query: CUSTOMERS_QUERY}),
    },
  );

  const json = (await res.json()) as {
    data?: {
      customers?: {
        edges: {
          node: {
            id: string;
            email: string;
            firstName: string | null;
            lastName: string | null;
            numberOfOrders: number;
            amountSpent: {amount: string; currencyCode: string};
            createdAt: string;
            verifiedEmail: boolean;
          };
        }[];
      };
    };
  };

  const customers: Customer[] = (json.data?.customers?.edges ?? []).map(
    ({node}) => ({
      id: node.id,
      email: node.email,
      firstName: node.firstName,
      lastName: node.lastName,
      ordersCount: node.numberOfOrders,
      totalSpent: `${node.amountSpent.amount} ${node.amountSpent.currencyCode}`,
      createdAt: node.createdAt,
      verifiedEmail: node.verifiedEmail,
    }),
  );

  return data({customers});
}

export default function AdminDemo() {
  const {customers} = useLoaderData<typeof loader>();
  const {revalidate, state} = useRevalidator();
  const isRefreshing = state === 'loading';

  return (
    <div className="max-w-5xl mx-auto px-4 py-10 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Customers ({customers.length})</h1>
        <button
          type="button"
          onClick={revalidate}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
        >
          <span className={isRefreshing ? 'animate-spin' : ''}>↻</span>
          {isRefreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Email</th>
              <th className="px-4 py-3 text-center">Verified</th>
              <th className="px-4 py-3 text-right">Orders</th>
              <th className="px-4 py-3 text-right">Total Spent</th>
              <th className="px-4 py-3 text-left">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {customers.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-medium text-gray-900">
                  {[c.firstName, c.lastName].filter(Boolean).join(' ') || '—'}
                </td>
                <td className="px-4 py-3 text-gray-600">{c.email}</td>
                <td className="px-4 py-3 text-center">
                  {c.verifiedEmail ? (
                    <span className="text-green-600 font-bold">✓</span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-gray-700">
                  {c.ordersCount}
                </td>
                <td className="px-4 py-3 text-right text-gray-700">
                  {c.totalSpent}
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">
                  {new Date(c.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
