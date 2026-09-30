import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { selectProjectById, selectProjectDetail, selectProjects } from '../state/selectors'

// Error and fallback branches of every exported api.ts function (#608).
// API_URL is read at module load, so each test stubs the env and re-imports.

vi.mock('../wallet/registry', () => ({
  isRegistryConfigured: () => false,
  fetchProjectsPage: vi.fn(),
  fetchProjectWithDetails: vi.fn(),
}))

const API = 'https://api.example.test'

type Api = typeof import('./api')

/** Re-import api.ts with NEXT_PUBLIC_API_URL set (or unset when null). */
async function loadApi(apiUrl: string | null = API): Promise<Api> {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_API_URL', apiUrl ?? '')
  return import('./api')
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function malformedResponse(): Response {
  return new Response('<html>502 Bad Gateway</html>', { status: 200 })
}

/** A fetch that never settles until the request's AbortSignal fires. */
function hangingFetch(_url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return new Promise((_, reject) => {
    init?.signal?.addEventListener('abort', () =>
      reject(new DOMException('The operation was aborted.', 'AbortError')),
    )
  })
}

type Failure = { name: string; mock: () => void; reason: RegExp }

const failures: Failure[] = [
  {
    name: '4xx',
    mock: () => vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: 'nope' }, 404)),
    reason: /\(HTTP 404\)/,
  },
  {
    name: '5xx',
    mock: () => vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: 'boom' }, 503)),
    reason: /\(HTTP 503\)/,
  },
  {
    name: 'network error',
    mock: () => vi.mocked(fetch).mockRejectedValue(new TypeError('fetch failed')),
    reason: /\(fetch failed\)/,
  },
  {
    name: 'malformed JSON',
    mock: () => vi.mocked(fetch).mockResolvedValue(malformedResponse()),
    reason: /\(.*JSON.*\)/,
  },
]

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

/** Run `call` against a fetch that hangs, advancing fake timers past the timeout. */
async function withTimeout<T>(api: Api, call: () => Promise<T>): Promise<T> {
  vi.useFakeTimers()
  vi.mocked(fetch).mockImplementation(hangingFetch)
  const pending = call().then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  )
  await vi.advanceTimersByTimeAsync(api.API_TIMEOUT_MS + 1)
  const outcome = await pending
  if ('error' in outcome) throw outcome.error
  return outcome.value
}

function lastWarning(): string {
  return String(warn.mock.calls.at(-1)?.[0] ?? '')
}

describe('getProjects', () => {
  it.each(failures)('surfaces production errors on $name', async ({ mock }) => {
    const api = await loadApi()
    mock()
    await expect(api.getProjects()).rejects.toThrow()
    expect(fetch).toHaveBeenCalledWith(
      `${API}/projects`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(warn).not.toHaveBeenCalled()
  })

  it('surfaces request timeouts', async () => {
    const api = await loadApi()
    await expect(withTimeout(api, () => api.getProjects())).rejects.toThrow()
  })

  it('never reports the literal "HTTP {res.status}" placeholder', async () => {
    const api = await loadApi()
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}, 500))
    await expect(api.getProjects()).rejects.toThrow('HTTP 500')
  })

  it('request helper throws typed ApiError with status, code, and message', async () => {
    const api = await loadApi()
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: 'server error' }, 503))
    try {
      await api.request('/test-endpoint')
      expect.fail('should have thrown')
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(api.ApiError)
      const apiErr = err as InstanceType<typeof api.ApiError>
      expect(apiErr.status).toBe(503)
      expect(apiErr.code).toBe('HTTP_503')
      expect(apiErr.message).toBe('HTTP 503')
    }
  })

  it('returns the API payload on success', async () => {
    const api = await loadApi()
    const remote = [{ ...selectProjects()[0], name: 'Remote project' }]
    vi.mocked(fetch).mockResolvedValue(jsonResponse(remote))
    await expect(api.getProjects()).resolves.toEqual(remote)
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('getProjectsPaginated', () => {
  it.each(failures)('surfaces paginated production errors on $name', async ({ mock }) => {
    const api = await loadApi()
    mock()
    await expect(api.getProjectsPaginated(1, 2)).rejects.toThrow()
    expect(fetch).toHaveBeenCalledWith(`${API}/projects?page=1&limit=2`, expect.anything())
    expect(warn).not.toHaveBeenCalled()
  })

  it('surfaces request timeouts', async () => {
    const api = await loadApi()
    await expect(withTimeout(api, () => api.getProjectsPaginated(2, 3))).rejects.toThrow()
  })

  it('pages a plain array response client-side', async () => {
    const api = await loadApi()
    const all = selectProjects()
    vi.mocked(fetch).mockResolvedValue(jsonResponse(all))
    const res = await api.getProjectsPaginated(2, 2)
    expect(res.projects).toEqual(all.slice(2, 4))
    expect(res.total).toBe(all.length)
  })

  it('passes a paginated response through', async () => {
    const api = await loadApi()
    const body = { projects: [], total: 0, page: 1, pageSize: 12, hasMore: false }
    vi.mocked(fetch).mockResolvedValue(jsonResponse(body))
    await expect(api.getProjectsPaginated()).resolves.toEqual(body)
  })

  it('slices the local dataset when no API is configured', async () => {
    const api = await loadApi(null)
    const res = await api.getProjectsPaginated(1, 1)
    expect(res.projects).toEqual(selectProjects().slice(0, 1))
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('getProject', () => {
  const id = selectProjects()[0].id

  it.each(failures)('surfaces production errors on $name', async ({ mock }) => {
    const api = await loadApi()
    mock()
    await expect(api.getProject(id)).rejects.toThrow()
    expect(fetch).toHaveBeenCalledWith(`${API}/projects/${id}`, expect.anything())
    expect(warn).not.toHaveBeenCalled()
  })

  it('surfaces request timeouts', async () => {
    const api = await loadApi()
    await expect(withTimeout(api, () => api.getProject(id))).rejects.toThrow()
  })

  it('surfaces not-found responses when there is no local project', async () => {
    const api = await loadApi()
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}, 404))
    await expect(api.getProject(99999)).rejects.toThrow('HTTP 404')
  })

  it('returns the API payload on success', async () => {
    const api = await loadApi()
    const body = { project: selectProjectById(id), detail: selectProjectDetail(id) }
    vi.mocked(fetch).mockResolvedValue(jsonResponse(body))
    await expect(api.getProject(id)).resolves.toEqual(body)
  })
})

describe('createInvestment', () => {
  const input = { projectId: 2, amount: 150 }

  it.each(failures)('surfaces production errors on $name', async ({ mock }) => {
    const api = await loadApi()
    mock()
    await expect(api.createInvestment(input)).rejects.toThrow()
    expect(fetch).toHaveBeenCalledWith(
      `${API}/investments`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify(input) }),
    )
    expect(warn).not.toHaveBeenCalled()
  })

  it('surfaces request timeouts', async () => {
    const api = await loadApi()
    await expect(withTimeout(api, () => api.createInvestment(input))).rejects.toThrow()
  })

  it('returns the created investment with a normalised projectUrl', async () => {
    const api = await loadApi()
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ id: 7, projectId: 2, amount: 150, projectUrl: 'https://elsewhere' }),
    )
    await expect(api.createInvestment(input)).resolves.toEqual({
      id: 7,
      projectId: 2,
      amount: 150,
      projectUrl: '/projects/2',
    })
  })

  it('rejects invalid input before calling the API', async () => {
    const api = await loadApi()
    await expect(api.createInvestment({ projectId: 0, amount: 1 })).rejects.toThrow(
      'Invalid investment input',
    )
    await expect(api.createInvestment({ projectId: 1, amount: Infinity })).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('getPriceHistory', () => {
  it.each(failures)('surfaces production errors on $name', async ({ mock }) => {
    const api = await loadApi()
    mock()
    await expect(api.getPriceHistory(1)).rejects.toThrow()
    expect(fetch).toHaveBeenCalledWith(`${API}/projects/1/price-history`, expect.anything())
    expect(warn).not.toHaveBeenCalled()
  })

  it('surfaces request timeouts', async () => {
    const api = await loadApi()
    await expect(withTimeout(api, () => api.getPriceHistory(1))).rejects.toThrow()
  })

  it('rejects when the payload is not an array', async () => {
    const api = await loadApi()
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ points: [] }))
    await expect(api.getPriceHistory(1)).rejects.toThrow()
  })

  it('sorts API points chronologically', async () => {
    const api = await loadApi()
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse([
        { date: '2026-03-02', price: 2 },
        { date: '2026-03-01', price: 1 },
      ]),
    )
    const points = await api.getPriceHistory(1)
    expect(points.map((p) => p.date)).toEqual(['2026-03-01', '2026-03-02'])
  })

  it('generates ascending mock history without an API', async () => {
    const api = await loadApi(null)
    const points = await api.getPriceHistory(2)
    expect(points).toHaveLength(30)
    expect(points[0].date < points[29].date).toBe(true)
  })
})

describe('biometricLogin', () => {
  it('returns false when WebAuthn is unavailable', async () => {
    const api = await loadApi()
    vi.stubGlobal('PublicKeyCredential', undefined)
    await expect(api.biometricLogin()).resolves.toBe(false)
    expect(lastWarning()).toContain('not supported')
  })

  it('returns true when server challenge-response succeeds', async () => {
    const api = await loadApi()
    vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {})
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/login/begin')) {
        return Promise.resolve(jsonResponse({ challenge: 'dGVzdA', allowCredentials: [] }))
      }
      if (url.includes('/login/complete')) {
        return Promise.resolve(jsonResponse({ verified: true }))
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const get = vi.fn().mockResolvedValue({
      id: 'cred-123',
      rawId: new Uint8Array([1, 2, 3]).buffer,
      type: 'public-key',
      response: {
        authenticatorData: new Uint8Array([4, 5]).buffer,
        clientDataJSON: new Uint8Array([6, 7]).buffer,
        signature: new Uint8Array([8, 9]).buffer,
      },
    })
    vi.stubGlobal('navigator', { ...navigator, credentials: { get } })

    await expect(api.biometricLogin('user@example.com')).resolves.toBe(true)
    expect(mockFetch).toHaveBeenCalledWith('/webauthn/login/begin', expect.anything())
    expect(get).toHaveBeenCalled()
    expect(mockFetch).toHaveBeenCalledWith('/webauthn/login/complete', expect.anything())
  })

  it('returns false when the authenticator or server rejects', async () => {
    const api = await loadApi()
    vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {})
    const get = vi.fn().mockRejectedValue(new Error('NotAllowedError'))
    vi.stubGlobal('navigator', { ...navigator, credentials: { get } })
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ challenge: 'dGVzdA', allowCredentials: [] }))
    await expect(api.biometricLogin('user@example.com')).resolves.toBe(false)
    expect(get).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
