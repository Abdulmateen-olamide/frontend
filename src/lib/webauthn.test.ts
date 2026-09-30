// Unit tests for WebAuthn / biometric authentication helpers

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerBiometric, loginBiometric } from './webauthn'

describe('webauthn', () => {
  const mockFetch = vi.fn()
  const mockNavigatorCredentials = {
    create: vi.fn(),
    get: vi.fn(),
  }

  beforeEach(() => {
    global.fetch = mockFetch
    global.navigator = {
      credentials: mockNavigatorCredentials,
    } as unknown as Navigator

    // Reset mocks
    mockFetch.mockReset()
    mockNavigatorCredentials.create.mockReset()
    mockNavigatorCredentials.get.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('registerBiometric', () => {
    it('should perform base64url round-trip with padding correctly', async () => {
      const testString = 'test-challenge'
      const base64urlChallenge = btoa(testString).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            challenge: base64urlChallenge,
            user: { id: base64urlChallenge },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        })

      const mockCredential = {
        id: 'credential-id',
        rawId: new ArrayBuffer(16),
        type: 'public-key',
        response: {
          attestationObject: new ArrayBuffer(8),
          clientDataJSON: new ArrayBuffer(8),
        },
      }
      mockNavigatorCredentials.create.mockResolvedValue(mockCredential)

      const result = await registerBiometric('test-user')
      expect(result).toEqual({ success: true })
    })

    it('should handle - and _ characters in base64url correctly', async () => {
      // Base64url uses - and _ instead of + and /
      const specialChallenge = 'abc-def_123'
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            challenge: specialChallenge,
            user: { id: specialChallenge },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        })

      const mockCredential = {
        id: 'credential-id',
        rawId: new ArrayBuffer(16),
        type: 'public-key',
        response: {
          attestationObject: new ArrayBuffer(8),
          clientDataJSON: new ArrayBuffer(8),
        },
      }
      mockNavigatorCredentials.create.mockResolvedValue(mockCredential)

      await registerBiometric('test-user')
      expect(mockNavigatorCredentials.create).toHaveBeenCalledWith(
        expect.objectContaining({
          publicKey: expect.objectContaining({
            challenge: expect.any(ArrayBuffer),
            user: expect.objectContaining({
              id: expect.any(ArrayBuffer),
            }),
          }),
        }),
      )
    })

    it('should convert excludeCredentials ids to ArrayBuffer', async () => {
      const credId = btoa('excluded-cred-id').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      const challenge = btoa('test-challenge').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      const userId = btoa('user-id').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            challenge,
            user: { id: userId },
            excludeCredentials: [{ id: credId, type: 'public-key' }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        })

      const mockCredential = {
        id: 'credential-id',
        rawId: new ArrayBuffer(16),
        type: 'public-key',
        response: {
          attestationObject: new ArrayBuffer(8),
          clientDataJSON: new ArrayBuffer(8),
        },
      }
      mockNavigatorCredentials.create.mockResolvedValue(mockCredential)

      await registerBiometric('test-user')
      const createCall = mockNavigatorCredentials.create.mock.calls[0][0]
      expect(createCall.publicKey.excludeCredentials[0].id).toBeInstanceOf(ArrayBuffer)
    })

    it('should throw when registration is canceled (credential is null)', async () => {
      const challenge = btoa('test').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      const userId = btoa('user').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          challenge,
          user: { id: userId },
        }),
      })

      mockNavigatorCredentials.create.mockResolvedValue(null)

      await expect(registerBiometric('test-user')).rejects.toThrow('Registration canceled')
    })

    it('should throw and surface HTTP error message from server', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ error: 'Invalid username format' }),
      })

      await expect(registerBiometric('test-user')).rejects.toThrow('Invalid username format')
    })

    it('should fall back to statusText when error JSON is missing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => {
          throw new Error('Not JSON')
        },
      })

      await expect(registerBiometric('test-user')).rejects.toThrow('Service Unavailable')
    })
  })

  describe('loginBiometric', () => {
    it('should handle null userHandle correctly', async () => {
      const challenge = btoa('login-challenge').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            challenge,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        })

      const mockAssertion = {
        id: 'assertion-id',
        rawId: new ArrayBuffer(16),
        type: 'public-key',
        response: {
          authenticatorData: new ArrayBuffer(8),
          clientDataJSON: new ArrayBuffer(8),
          signature: new ArrayBuffer(8),
          userHandle: null,
        },
      }
      mockNavigatorCredentials.get.mockResolvedValue(mockAssertion)

      const result = await loginBiometric('test-user')
      expect(result).toEqual({ success: true })

      const completeCall = mockFetch.mock.calls[1][1]
      const body = JSON.parse(completeCall?.body as string)
      expect(body.credential.response.userHandle).toBeNull()
    })

    it('should convert allowCredentials ids to ArrayBuffer', async () => {
      const credId = btoa('allowed-cred-id').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      const challenge = btoa('test-challenge').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            challenge,
            allowCredentials: [{ id: credId, type: 'public-key' }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        })

      const mockAssertion = {
        id: 'assertion-id',
        rawId: new ArrayBuffer(16),
        type: 'public-key',
        response: {
          authenticatorData: new ArrayBuffer(8),
          clientDataJSON: new ArrayBuffer(8),
          signature: new ArrayBuffer(8),
          userHandle: new ArrayBuffer(8),
        },
      }
      mockNavigatorCredentials.get.mockResolvedValue(mockAssertion)

      await loginBiometric('test-user')
      const getCall = mockNavigatorCredentials.get.mock.calls[0][0]
      expect(getCall.publicKey.allowCredentials[0].id).toBeInstanceOf(ArrayBuffer)
    })

    it('should throw when authentication is canceled (assertion is null)', async () => {
      const challenge = btoa('test').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          challenge,
        }),
      })

      mockNavigatorCredentials.get.mockResolvedValue(null)

      await expect(loginBiometric('test-user')).rejects.toThrow('Authentication canceled')
    })

    it('should throw and surface HTTP error message from login endpoint', async () => {
      const challenge = btoa('test').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          challenge,
        }),
      })

      const mockAssertion = {
        id: 'assertion-id',
        rawId: new ArrayBuffer(16),
        type: 'public-key',
        response: {
          authenticatorData: new ArrayBuffer(8),
          clientDataJSON: new ArrayBuffer(8),
          signature: new ArrayBuffer(8),
          userHandle: new ArrayBuffer(8),
        },
      }
      mockNavigatorCredentials.get.mockResolvedValue(mockAssertion)

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ error: 'Credential not found' }),
      })

      await expect(loginBiometric('test-user')).rejects.toThrow('Credential not found')
    })

    it('should convert userHandle to base64url when present', async () => {
      const challenge = btoa('test').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            challenge,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        })

      const userHandle = new Uint8Array([1, 2, 3, 4]).buffer
      const mockAssertion = {
        id: 'assertion-id',
        rawId: new ArrayBuffer(16),
        type: 'public-key',
        response: {
          authenticatorData: new ArrayBuffer(8),
          clientDataJSON: new ArrayBuffer(8),
          signature: new ArrayBuffer(8),
          userHandle,
        },
      }
      mockNavigatorCredentials.get.mockResolvedValue(mockAssertion)

      await loginBiometric('test-user')

      const completeCall = mockFetch.mock.calls[1][1]
      const body = JSON.parse(completeCall?.body as string)
      expect(body.credential.response.userHandle).toBeTruthy()
      expect(typeof body.credential.response.userHandle).toBe('string')
    })
  })
})
