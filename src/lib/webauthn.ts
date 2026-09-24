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

interface CredentialDescriptorJSON {
  id: string
  type: PublicKeyCredentialType
  transports?: AuthenticatorTransport[]
}

interface RegistrationBeginResponse {
  challenge: string
  rp: PublicKeyCredentialRpEntity
  user: {
    id: string
    name: string
    displayName: string
  }
  pubKeyCredParams: PublicKeyCredentialParameters[]
  timeout?: number
  excludeCredentials?: CredentialDescriptorJSON[]
  authenticatorSelection?: AuthenticatorSelectionCriteria
  attestation?: AttestationConveyancePreference
  extensions?: AuthenticationExtensionsClientInputs
}

interface LoginBeginResponse {
  challenge: string
  timeout?: number
  rpId?: string
  allowCredentials?: CredentialDescriptorJSON[]
  userVerification?: UserVerificationRequirement
  extensions?: AuthenticationExtensionsClientInputs
}

async function postJSON<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string }
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function registerBiometric(username: string): Promise<unknown> {
  const options = await postJSON<RegistrationBeginResponse>('/webauthn/register/begin', {
    username,
  })

  // Convert base64url fields to ArrayBuffer for WebAuthn API
  const publicKeyOptions: PublicKeyCredentialCreationOptions = {
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
  }

  const credential = (await navigator.credentials.create({
    publicKey: publicKeyOptions,
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

  return postJSON('/webauthn/register/complete', { username, credential: credentialJSON })
}

export async function loginBiometric(username: string): Promise<unknown> {
  const options = await postJSON<LoginBeginResponse>('/webauthn/login/begin', { username })

  const publicKeyOptions: PublicKeyCredentialRequestOptions = {
    ...options,
    challenge: base64urlToArrayBuffer(options.challenge),
    allowCredentials: options.allowCredentials?.map((cred) => ({
      ...cred,
      id: base64urlToArrayBuffer(cred.id),
    })),
  }

  const assertion = (await navigator.credentials.get({
    publicKey: publicKeyOptions,
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

  return postJSON('/webauthn/login/complete', { username, credential: credentialJSON })
}
