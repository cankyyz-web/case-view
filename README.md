# Case View

A mobile-friendly 3D case viewer: an object list with show/hide, a transparency slider, a mesh toggle, shading and projection settings, and standard views. Built for STL, PLY, and OBJ, including the `Upper_Jaw.stl` / `Teeth.stl` names from Mobile Ready.

GitHub Pages hosts the viewer so the site stays online. Each case link only opens its files until the time you pick. After that, the page still loads and says the link has expired.

Opening a shared link shows only a 4-digit PIN pad. After the PIN is accepted, the viewer opens and the meshes download on their own. There is no account. Uploading happens on this computer.

## What a link contains

One private bucket named `cases`. Each case is a folder, for example `cases/2026-09-28-upper/Upper_Jaw.stl`.

The local tool uploads into that folder, creates a signed URL for every mesh in it, and encrypts that URL list with the PIN. The phone gets one link. After the PIN, the viewer opens and loads those files. The signed URLs last exactly as long as the link.

Type a 4-digit PIN or press Generate. Leave the PIN blank and Create link will generate one. The code is shown once and is not saved.

PBKDF2-SHA-256 stretches it for 50,000 iterations into an AES-256-GCM key. The check is whether decryption succeeds. That runs in `supabase/functions/_shared/encrypter.ts`. Five wrong tries lock the link for 15 minutes.

## Setup

1. In the Supabase SQL editor, run `supabase/schema.sql`. If the `shares` table already exists from an earlier run, run it again so `owner_id` is optional.
2. The PIN function is already deployed as `verify-pin` with JWT verification off. Deploy again only if that function changes:

```bat
npx.cmd supabase functions deploy verify-pin --no-verify-jwt
```

3. Copy `.env.example` to `.env` and set:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (the anon / public key)
- `SUPABASE_SERVICE_ROLE_KEY` (the secret key; no `VITE_` prefix)
- `VITE_PUBLIC_ORIGIN` to the GitHub Pages address, with no slash at the end, for example `https://YOUR_USER.github.io/case-view`

4. Start the local tool with `run.bat` and open `http://127.0.0.1:5173/`. Drop files, pick how long the link lasts, and create the link. Send that `https://…github.io/…/#/v/…` address and the PIN. Do not send the localhost page.

## GitHub Pages

Publish only this `webview` folder, as a public repository. The workflow in `.github/workflows/pages.yml` builds the site. Repository secrets are `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` only. The service role key stays in `.env` on this computer.

In the repository, open Settings, Pages, and set the source to GitHub Actions. The site address is `https://YOUR_USER.github.io/REPOSITORY_NAME/`. Put that in `VITE_PUBLIC_ORIGIN`.

## Viewer

- Drag to orbit, pinch to zoom, two fingers to pan.
- Press and hold the model to move the rotation point.
- Object checkboxes show and hide. The slider is transparency. The triangle button switches that object to a mesh.
- Settings: smooth or flat shading, vertex color, perspective or orthographic, Z-up or Y-up, light or dark background.
- On a phone the object list and settings open as a bottom sheet.

Preview sample works before Supabase is connected. Creating a link needs the keys in `.env`.
