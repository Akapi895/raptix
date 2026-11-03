import { installMock } from '@/mock';

export function startDemo(): () => void {
  return installMock();
}
