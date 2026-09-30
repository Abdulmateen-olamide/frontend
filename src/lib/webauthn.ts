// src/lib/webauthn.ts
// WebAuthn / biometric authentication helpers.

interface PublicKeyCredentialCreationOptionsJSON {
  challenge: string
  user: {
    id: string
    name: string
    displayName: string
  }
  rp?: {
    name: string
    id?: string
  }
  pubKeyCredParams?: Array<{ type: string; alg: number }>
  timeout?: number
  excludeCredentials?: Array<{ id: string; type: string }>
  authenticatorSelection?: {
    authenticatorAttachment?: string
    requireResidentKey?: boolean
    residentKey?: string
    userVerification?: string
  }
}

interface PublicKeyCredentialRequestOptionsJSON {
  challenge: string
  timeout?: number
  rpId?: string
  allowCredentials?: Array<{ id: string; type: string }>
  userVerification?: string
}

interface ServerResponse {
  error?: string
  [key: string]: unknown
}

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

async function postJSON<T = ServerResponse>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as ServerResponse
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function registerBiometric(username: string): Promise<ServerResponse> {
  const options = await postJSON<PublicKeyCredentialCreationOptionsJSON>('/webauthn/register/begin', { username })

  // Convert base64url fields to ArrayBuffer for WebAuthn API
  const publicKeyOptions: PublicKeyCredentialCreationOptions = {
    challenge: base64urlToArrayBuffer(options.challenge),
    user: {
      ...options.user,
      id: base64urlToArrayBuffer(options.user.id),
    },
    rp: options.rp || { name: options.user.displayName }, // Use display name as fallback for rp.name
    pubKeyCredParams: (options.pubKeyCredParams as PublicKeyCredentialParameters[]) || [
      { type: 'public-key', alg: -7 }, // ES256
    ],
  }
  
  if (options.timeout) publicKeyOptions.timeout = options.timeout
  if (options.authenticatorSelection) publicKeyOptions.authenticatorSelection = options.authenticatorSelection as AuthenticatorSelectionCriteria
  
  if (options.excludeCredentials) {
    publicKeyOptions.excludeCredentials = options.excludeCredentials.map((cred) => ({
      id: base64urlToArrayBuffer(cred.id),
      type: cred.type as PublicKeyCredentialType,
    }))
  }

  const credential = (await navigator.credentials.create({
    publicKey: publicKeyOptions,
  })) as PublicKeyCredential & { response: AuthenticatorAttestationResponse }

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

  return postJSON('/webauthn/register/complete', { username, credential: credentialJSON })
}

export async function loginBiometric(username: string): Promise<ServerResponse> {
  const options = await postJSON<PublicKeyCredentialRequestOptionsJSON>('/webauthn/login/begin', { username })

  const publicKeyOptions: PublicKeyCredentialRequestOptions = {
    challenge: base64urlToArrayBuffer(options.challenge),
  }
  
  if (options.timeout) publicKeyOptions.timeout = options.timeout
  if (options.rpId) publicKeyOptions.rpId = options.rpId
  if (options.userVerification) publicKeyOptions.userVerification = options.userVerification as UserVerificationRequirement
  
  if (options.allowCredentials) {
    publicKeyOptions.allowCredentials = options.allowCredentials.map((cred) => ({
      id: base64urlToArrayBuffer(cred.id),
      type: cred.type as PublicKeyCredentialType,
    }))
  }

  const assertion = (await navigator.credentials.get({
    publicKey: publicKeyOptions,
  })) as PublicKeyCredential & { response: AuthenticatorAssertionResponse }

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

  return postJSON('/webauthn/login/complete', { username, credential: credentialJSON })
}
