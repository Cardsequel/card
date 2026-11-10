# Node.js & Passport Login

This is a user login and registration app using Node.js, Express, Passport, Mongoose, EJS and some other packages.

### Version: 2.0.0

### Usage

```sh
$ npm install
```

```sh
$ npm start
# Or run with Nodemon
$ npm run dev

# Visit http://localhost:5000
```

### Search engine indexing

The public marketing pages have canonical URLs and page-specific search and social
metadata. The app serves `/robots.txt`, `/sitemap.xml`, and `/llms.txt` to help
search engines and AI systems discover public information. The sitemap and
`/llms.txt` contain only public pages, while account and dashboard routes are marked `noindex`.
The `/contact` route currently has no page content, so it remains `noindex` and
is excluded from the sitemap until contact information is added.

Set `SITE_URL` to the site's public origin in production so canonical URLs, the
sitemap, and `/llms.txt` use the deployment's preferred domain and protocol:

```sh
SITE_URL=https://example.com npm start
```

If `SITE_URL` is unset, the current request origin is used. Do not include a
path, query string, or fragment in `SITE_URL`.

### MongoDB

Open "config/keys.js" and add your MongoDB URI, local or Atlas

### Admin access

The admin dashboard is served by the same application at `/admin-dashboard`. After
login, accounts whose MongoDB `category` is `admin` are sent there; all other accounts
are sent to `/dashboard`. Admin routes check the account category in MongoDB on every
request. The dashboard summarizes account counts and balances/activity, and admins
can edit a user's profile, account category, balances, card details, and registration
date from the Accounts page at `/admin`. Password resets are optional and stored as
hashes; current passwords and password confirmations are never displayed.
The dashboard and Accounts page count non-admin accounts created before October 18,
2026 as V1, and those created on or after that date as V2. Accounts without a valid
registration date are excluded from both counts.
Dashboard money totals use decimal arithmetic and normalize dollar signs and thousands
separators. Any remaining invalid account amounts are reported beside the totals
instead of being silently counted as zero.

### Converting existing account balances

Balance fields now use MongoDB numbers. The migration scans existing accounts and
converts formatted text such as `1,234.56` or `$1,234.56`. Back up the database, then
run a dry run:

Admins can also open and edit legacy formatted balances from the Accounts page
without running this migration first; saving converts the edited balances to numbers.

```sh
npm run migrate:user-balances
```

If the report is correct, apply conversions with:

```sh
npm run migrate:user-balances -- --apply
```

Values that cannot be parsed are left unchanged and reported for manual correction.

New registrations always use the default `user` category. To grant admin access,
promote an existing account directly in MongoDB:

```javascript
db.users.updateOne(
  { email: "admin@example.com" },
  { $set: { category: "admin" } }
);
```

Older accounts may have a legacy `password2` field containing an unencrypted
password confirmation. After backing up the database, remove that obsolete field:

```javascript
db.users.updateMany({}, { $unset: { password2: "" } });
```
# vine
# vine
# ventprise
# exora
# rifle
# CM
# CM
# card
# card
# card
# card
