/**
 * W15: the campaigns surface must speak the real provider contract — draft
 * specs carry GoPhish assets or the Evilginx synthetic lab profile, job
 * actions submit a stable requestId plus the draft's current version, and
 * unsupported vectors are disclosed as persist-only instead of pretending a
 * supported provider workflow.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import type { CampaignsView, CampaignProviderCapabilities } from '@raptix/web-contracts'

const fetchCampaignCapabilities = vi.fn()
const fetchCampaigns = vi.fn()
const createCampaign = vi.fn()
const runCampaignJob = vi.fn()
const reconcileCampaignJob = vi.fn()

vi.mock('../../features/c2/remote', () => ({
  fetchCampaignCapabilities: (...a: unknown[]) => fetchCampaignCapabilities(...a),
  fetchCampaigns: (...a: unknown[]) => fetchCampaigns(...a),
  createCampaign: (...a: unknown[]) => createCampaign(...a),
  runCampaignJob: (...a: unknown[]) => runCampaignJob(...a),
  reconcileCampaignJob: (...a: unknown[]) => reconcileCampaignJob(...a),
}))

const CAPS: CampaignProviderCapabilities = {
  engagementId: 'eng-1',
  draftPersistence: true,
  providers: [
    { provider: 'gophish', generateConfigured: true, deployConfigured: true, deploymentScope: 'isolated-lab' },
    { provider: 'evilginx2', generateConfigured: false, deployConfigured: false, deploymentScope: 'isolated-lab' },
  ],
  source: 'configuration',
}

function campaignsView(campaign?: Partial<{ id: string; version: number; vector: string; spec: Record<string, unknown> }>): CampaignsView {
  return {
    engagementId: 'eng-1',
    campaigns: [{
      id: campaign?.id ?? 'c-1',
      engagementId: 'eng-1',
      name: 'Q4 drill',
      vector: (campaign?.vector ?? 'phishing') as CampaignsView['campaigns'][number]['vector'],
      status: 'draft',
      version: campaign?.version ?? 3,
      spec: campaign?.spec ?? { scenario: null },
      jobs: [],
      createdAt: '2026-10-15T01:00:00.000Z',
      updatedAt: '2026-10-15T01:00:00.000Z',
    }],
    truncated: false,
  }
}

async function renderPanel(): Promise<void> {
  const { RealCampaignsPanel } = await import('./campaigns-panel')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  render(<RealCampaignsPanel engagementId="eng-1" />, { wrapper })
}

beforeEach(() => {
  fetchCampaignCapabilities.mockReset()
  fetchCampaigns.mockReset()
  createCampaign.mockReset()
  runCampaignJob.mockReset()
  reconcileCampaignJob.mockReset()
  fetchCampaignCapabilities.mockResolvedValue(CAPS)
  fetchCampaigns.mockResolvedValue(campaignsView())
  createCampaign.mockResolvedValue({})
  runCampaignJob.mockResolvedValue({ id: 'j-1', status: 'uncertain' })
})

afterEach(() => {
  cleanup()
})

describe('RealCampaignsPanel (W15 provider contract)', () => {
  it('submits a phishing draft with GoPhish asset IDs and no Evilginx profile', async () => {
    await renderPanel()
    await userEvent.type(await screen.findByLabelText(/name/i), 'Phish drill')
    await userEvent.type(screen.getByLabelText(/template id/i), '11')
    await userEvent.type(screen.getByLabelText(/page id/i), '12')
    await userEvent.type(screen.getByLabelText(/group id/i), '13')
    await userEvent.type(screen.getByLabelText(/smtp id/i), '14')
    await userEvent.click(screen.getByRole('button', { name: /create draft/i }))
    await waitFor(() => expect(createCampaign).toHaveBeenCalledWith('eng-1', expect.objectContaining({
      name: 'Phish drill',
      vector: 'phishing',
      gophish: { templateId: 11, pageId: 12, groupId: 13, smtpId: 14 },
    })))
    const body = createCampaign.mock.calls[0]![1] as Record<string, unknown>
    expect(body.evilginx).toBeUndefined()
  })

  it('submits the Evilginx synthetic lab profile only, without GoPhish assets', async () => {
    await renderPanel()
    await userEvent.type(await screen.findByLabelText(/name/i), 'Lab only')
    await userEvent.click(screen.getByLabelText(/evilginx synthetic lab profile/i))
    await userEvent.click(screen.getByRole('button', { name: /create draft/i }))
    await waitFor(() => expect(createCampaign).toHaveBeenCalledWith('eng-1', expect.objectContaining({
      vector: 'phishing',
      evilginxLab: true,
    })))
    const body = createCampaign.mock.calls[0]![1] as Record<string, unknown>
    expect(body.gophish).toBeUndefined()
  })

  it('runs provider jobs with a stable requestId and the draft current version', async () => {
    await renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: /generate/i }))
    await waitFor(() => expect(runCampaignJob).toHaveBeenCalledWith('eng-1', 'c-1', 'generate', {
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      version: 3,
    }))
  })

  it('discloses web and mobile vectors as persist-only, without a supported provider workflow', async () => {
    await renderPanel()
    expect(await screen.findByText(/web and mobile drafts persist without a provider workflow/i)).toBeInTheDocument()
  })
})
