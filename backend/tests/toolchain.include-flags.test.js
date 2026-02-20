import { toolchainService } from '../src/services/toolchain.service.js';

describe('toolchain include flags by language', () => {
  it('does not inject libc++ include path for C mode', () => {
    const flags = toolchainService.getIncludeFlags('c');
    const joined = flags.join(' ');

    expect(flags).not.toContain('-nostdinc++');
    expect(joined).not.toMatch(/[\\/]c\+\+[\\/]v1/);
  });

  it('injects libc++ include path for C++ mode', () => {
    const flags = toolchainService.getIncludeFlags('cpp');
    const joined = flags.join(' ');

    expect(flags).toContain('-nostdinc++');
    expect(joined).toMatch(/[\\/]c\+\+[\\/]v1/);
  });
});
