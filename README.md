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
SITE_URL=https://cardsequel.cc npm start
```

If `SITE_URL` is unset, the app defaults to `https://cardsequel.cc`. Do not
include a path, query string, or fragment in `SITE_URL`.

### Admin email

On the Accounts page, administrators enter SMTP email, password, host, port,
and secure-connection setting in the send-email popup. Credentials are used
only for that message and are not saved. Select TLS for implicit TLS (commonly
port 465) or STARTTLS (commonly port 587). Set `SITE_URL` in the server
environment to prefill the public site origin in the email popup, or enter the
public site URL in the popup for the reset and unsubscribe links. The popup
defaults to `https://cardsequel.cc`.
Administrators can manually send either the
welcome email or a password-reset link to a selected account. Welcome emails are
not sent automatically at registration. Reset links expire after 24 hours and
can be used once; only a hash of each reset token is stored.
The welcome email's unsubscribe link saves the address to the promotional
suppression list in MongoDB. Unsubscribed addresses are not sent further welcome
emails; password-reset emails remain available. Admins can download the saved
addresses from the Accounts page as `unsubscribed-emails.txt`.

To send a designed HTML campaign to a newline-separated recipient list, use:

```sh
export UNSUBSCRIBE_SECRET="$(openssl rand -hex 32)"
# Configure this same secret in the live server environment.
SMTP_HOST=smtp.example.com \
SMTP_EMAIL=mailer@example.com \
SMTP_PASSWORD='your-smtp-password' \
SMTP_PORT=587 \
SMTP_SECURE=false \
UNSUBSCRIBE_SECRET="$UNSUBSCRIBE_SECRET" \
SITE_URL=https://cardsequel.cc \
npm run send:bulk-email -- recipients.txt email-design.html "Email subject"
```

The script sends one message per recipient and does not connect to MongoDB or
import project-local files; it requires Node.js and the `nodemailer` package
(already included when run from this project's installation). Remove any
previously unsubscribed addresses from `recipients.txt` before sending.

Include `{{UNSUBSCRIBE_URL}}` in the HTML design where the unsubscribe link
should go; otherwise, an unsubscribe link is appended. The link uses the
existing `/users/unsubscribe/:token` route and adds the address to the same
suppression list used by welcome emails. Set `UNSUBSCRIBE_SECRET` to the same
random secret of at least 32 characters on both the sending machine and the
live server; the server needs it to verify campaign unsubscribe links. Keep
SMTP credentials and this secret in environment variables, not source files.

### MongoDB

Open "config/keys.js" and add your MongoDB URI, local or Atlas

### Admin access

The admin dashboard is served by the same application at `/admin-dashboard`. After
login, accounts whose MongoDB `category` is `admin` are sent there; all other accounts
are sent to `/dashboard`. Admin routes check the account category in MongoDB on every
request. The dashboard summarizes account counts and balances/activity, and admins
can edit a user's profile, account category, balances, card details, and registration
date from the Accounts page at `/admin`. Select **See more** to edit an account,
send welcome or password-reset emails, or delete it. Account deletion also deletes
that account's top-up and crypto-withdrawal requests; requests reviewed by the
deleted admin are retained with the reviewer reference cleared. The active admin
and the last remaining admin cannot be deleted. Password resets are optional and
stored as hashes; current passwords and password confirmations are never displayed.
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
