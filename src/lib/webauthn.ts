// src/lib/webauthn.ts
// WebAuthn / biometric authentication helpers.

function base64urlToArrayBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const binaryString = atob(base64 + padding)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes.buffer
}

function arrayBufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

interface PublicKeyCredentialJSON {
  id: string
  rawId: string
  type: string
  response: Record<string, unknown>
}

/** A credential descriptor as it arrives over the wire (base64url-encoded id). */
interface WireCredential {
  id: string
  [key: string]: unknown
}

interface RegistrationOptions {
  challenge: string
  user: { id: string; [key: string]: unknown }
  excludeCredentials?: WireCredential[]
  [key: string]: unknown
}

interface LoginOptions {
  challenge: string
  allowCredentials?: WireCredential[]
  [key: string]: unknown
}

async function postJSON<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

export async function registerBiometric(username: string): Promise<void> {
  const options = await postJSON<RegistrationOptions>('/webauthn/register/begin', { username })

  // Convert base64url fields to ArrayBuffer for WebAuthn API
  const publicKey = {
    ...options,
    challenge: base64urlToArrayBuffer(options.challenge),
    user: {
      ...options.user,
      id: base64urlToArrayBuffer(options.user.id),
    },
    excludeCredentials: options.excludeCredentials?.map((cred) => ({
      ...cred,
      id: base64urlToArrayBuffer(cred.id),
    })),
  } as unknown as PublicKeyCredentialCreationOptions

  const credential = (await navigator.credentials.create({
    publicKey,
  })) as (PublicKeyCredential & { response: AuthenticatorAttestationResponse }) | null

  if (!credential) throw new Error('Registration canceled')

  const credentialJSON: PublicKeyCredentialJSON = {
    id: credential.id,
    rawId: arrayBufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      attestationObject: arrayBufferToBase64url(credential.response.attestationObject),
      clientDataJSON: arrayBufferToBase64url(credential.response.clientDataJSON),
    },
  }

  return postJSON<void>('/webauthn/register/complete', { username, credential: credentialJSON })
}

export async function loginBiometric(username: string): Promise<void> {
  const options = await postJSON<LoginOptions>('/webauthn/login/begin', { username })

  const publicKey = {
    ...options,
    challenge: base64urlToArrayBuffer(options.challenge),
    allowCredentials: options.allowCredentials?.map((cred) => ({
      ...cred,
      id: base64urlToArrayBuffer(cred.id),
    })),
  } as unknown as PublicKeyCredentialRequestOptions

  const assertion = (await navigator.credentials.get({
    publicKey,
  })) as (PublicKeyCredential & { response: AuthenticatorAssertionResponse }) | null

  if (!assertion) throw new Error('Authentication canceled')

  const credentialJSON: PublicKeyCredentialJSON = {
    id: assertion.id,
    rawId: arrayBufferToBase64url(assertion.rawId),
    type: assertion.type,
    response: {
      authenticatorData: arrayBufferToBase64url(assertion.response.authenticatorData),
      clientDataJSON: arrayBufferToBase64url(assertion.response.clientDataJSON),
      signature: arrayBufferToBase64url(assertion.response.signature),
      userHandle: assertion.response.userHandle
        ? arrayBufferToBase64url(assertion.response.userHandle)
        : null,
    },
  }

  return postJSON<void>('/webauthn/login/complete', { username, credential: credentialJSON })
}
