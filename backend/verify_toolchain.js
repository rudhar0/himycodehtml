
import { toolchainService } from './src/services/toolchain.service.js';
import compilerService from './src/services/compiler.service.js';
import fs from 'fs-extra';

async function verify() {
    console.log('--- Toolchain Verification ---');
    const status = await toolchainService.verify();
    console.log('Status:', JSON.stringify(status, null, 2));

    if (!status.compiler || !status.headers || !status.internal) {
        console.error('Core components missing!');
        process.exit(1);
    }

    console.log('\n--- Testing C++ Compilation ---');
    const testCode = `
#include <iostream>
#include <vector>
#include <string>

int main() {
    std::vector<std::string> msgs = {"Hello", "from", "ToolchainService"};
    for (const auto& msg : msgs) {
        std::cout << msg << " ";
    }
    std::cout << std::endl;
    return 0;
}
`;

    try {
        const result = await compilerService.compile(testCode, 'cpp');
        console.log('Compilation successful!');
        console.log('Executable:', result.executable);

        // Cleanup executable
        // await fs.remove(result.executable);
        // await fs.remove(result.sourceFile);
    } catch (e) {
        console.error('Compilation failed:');
        console.error(e.message);
        process.exit(1);
    }
}

verify().catch(console.error);
