This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Administrator access

Set `TUBELOCK_ADMIN_USER_IDS` to a comma-separated list of Neon `users.id` values for trusted administrators in your local and deployment environments. With the variable unset, administrator-only actions return HTTP 403.

Administrators can change shared settings, manage all video jobs, and use the legacy HLS upload endpoints. Signed-in users can use the standard upload flow and manage their own video jobs. Library entries without an owner require an administrator for management.

## Database migrations

Apply the numbered SQL files to an existing TubeLock database before deploying code that depends on them. Test on an isolated Neon branch first. Set `DATABASE_URL_UNPOOLED` to the branch's direct connection string and run `npm run db:migrate` with Node.js 22 or newer.

The script applies pending migrations in order, records them in `schema_migrations`, and rolls back the batch on failure. Restart active development instances after applying schema changes. Set `CRON_SECRET` on Vercel for the daily cleanup of expired view, rate-limit, and upload reservation records.

The standard upload flow defaults to 10 GiB per file and 100 GiB per uploader. Set `TUBELOCK_MAX_UPLOAD_GIB` and `TUBELOCK_USER_STORAGE_GIB` to override those limits.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
