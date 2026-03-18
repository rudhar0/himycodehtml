
import instrumenter from './backend/src/services/code-instrumenter.service.js';

const code = `
#include <iostream>
#include <cstdio>
using namespace std;
int main() {
    int x;
    cout << "Enter x: ";
    cin >> x;
    printf("You entered: %d\\n", x);
    return 0;
}
`;

async function test() {
    console.log('Original Code:', code);
    const instrumented = await instrumenter.instrumentCode(code);
    console.log('Instrumented Code:');
    console.log(instrumented);
}

test();
