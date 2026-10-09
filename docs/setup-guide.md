# Supabase & Google OAuth Setup Guide

This guide walks you through connecting your local environment to a live Supabase project, setting up Google OAuth credentials, and applying database migrations with seed data for development.

---

## Step 1: Create a Supabase Project

1. Visit [supabase.com](https://supabase.com) and sign in or create an account.
2. In the dashboard, click **New Project**.
3. Fill in:
   - **Name**: `CIH Message Platform` (or any preferred name).
   - **Database Password**: Set a strong password (save it safely).
   - **Region**: Choose the region closest to you.
4. Click **Create new project** and wait ~1–2 minutes for provisioning.
5. In the left navigation, click the **Project Settings** (gear icon) -> **API**:
   - **Project URL**: Copy `https://<your-project-ref>.supabase.co`.
   - **Project API Keys**: Copy the **`anon` `public`** key (starts with `ey...`).
   *(Note down `<your-project-ref>`—this is the 20-character identifier in your project URL).*

---

## Step 2: Apply Database Schema & Seed Data

1. In the Supabase left navigation, click **SQL Editor**.
2. Click **New query**.
3. Open the file [`supabase/complete_setup.sql`](../supabase/complete_setup.sql) in your code editor.
4. Copy its entire content, paste it into the Supabase SQL Editor, and click **Run**.
5. You should see `Success. No rows returned`.

> This executes all core tables, RLS policies, cryptographic procedures, and seeds the initial organization with `['gmail.com', 'cih.org', 'googlemail.com']` allowed domains.

---

## Step 3: Google Cloud OAuth 2.0 Credentials

1. Go to the [Google Cloud Console](https://console.cloud.google.com).
2. Select or create a project (e.g., `CIH Platform`).
3. In the navigation menu (or search bar), go to **APIs & Services** > **OAuth consent screen**:
   - Choose **External** user type and click **Create**.
   - Fill in:
     - **App name**: `CIH Platform`
     - **User support email**: Select your email.
     - **Developer contact email**: Enter your email.
   - Click **Save and Continue**.
   - Under **Scopes**, click **Add or Remove Scopes**, select:
     - `.../auth/userinfo.email`
     - `.../auth/userinfo.profile`
     - `openid`
   - Click **Update**, then **Save and Continue**.
   - Under **Test users**, click **Add Users**:
     - Enter your personal `@gmail.com` address that you will use to sign in.
     - Click **Save and Continue**, then **Back to Dashboard**.

4. Go to **APIs & Services** > **Credentials**:
   - Click **+ CREATE CREDENTIALS** > **OAuth client ID**.
   - **Application type**: **Web application**.
   - **Name**: `CIH Supabase Client`.
   - Under **Authorized redirect URIs**, click **+ ADD URI**:
     - Enter: `https://<your-project-ref>.supabase.co/auth/v1/callback`
     - *(Replace `<your-project-ref>` with your real project reference from Step 1).*
   - Click **Create**.
   - Note down the generated **Client ID** and **Client Secret**.

---

## Step 4: Configure Google Provider in Supabase

1. Back in your [Supabase Dashboard](https://supabase.com/dashboard), navigate to **Authentication** > **Providers**.
2. Expand **Google**:
   - Toggle **Enable Sign in with Google** to **ON**.
   - Paste your **Client ID**.
   - Paste your **Client Secret**.
   - Click **Save**.
3. Under **Authentication** > **URL Configuration**:
   - **Site URL**: `http://localhost:3000`
   - **Redirect URLs**: Add both:
     - `http://localhost:3000/auth/callback`
     - `http://localhost:3000/**`
   - Click **Save**.

---

## Step 5: Update Local `.env.local`

Update your local `.env.local` file with the values from Step 1:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...<your-anon-key>
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## Step 6: Test Authentication Flow

1. Start your local dev server:
   ```powershell
   npm.cmd run dev
   ```
2. Navigate to `http://localhost:3000/login`.
3. Click **Continue with Google**.
4. Sign in with your test `@gmail.com` account.
5. You will be redirected to `/onboarding` to pick your display name and username.
6. Submit onboarding to enter `/app`!
