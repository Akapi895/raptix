import { describe, expect, it } from 'vitest';
import { artifactGroup, canPreview } from './artifacts';

describe('workspace output selection', () => {
  it('prioritizes generated outputs while excluding internal and source files from the default view', () => {
    expect(artifactGroup({ source: 'conversation_artifact', name: 'assessment.pdf' })).toBe('Reports');
    expect(artifactGroup({ source: 'workspace', name: 'capture.pcap' })).toBe('Evidence');
    expect(artifactGroup({ source: 'workspace', name: 'nuclei.json' })).toBe('Scan results');
    expect(artifactGroup({ source: 'upload', name: 'scope.txt' })).toBe('Files');
    expect(artifactGroup({ source: 'workspace', subPath: 'node_modules/pkg', name: 'report.json' })).toBeNull();
    expect(artifactGroup({ source: 'workspace', name: 'app.py' })).toBeNull();
    expect(artifactGroup({ source: 'reduction', name: 'summary.md' })).toBeNull();
    expect(artifactGroup({ name: '.env' })).toBeNull();
  });
  it('offers text preview only for supported files within the API size limit', () => {
    expect(canPreview({ relativePath: 'results/scan.json', size: 1024 })).toBe(true);
    expect(canPreview({ relativePath: 'results/scan.json', size: 3 * 1024 * 1024 })).toBe(false);
    expect(canPreview({ relativePath: 'report.pdf' })).toBe(false);
    expect(canPreview({ name: 'report.md' })).toBe(false);
  });
});
