import tracer from "./src/services/instrumentation-tracer.service.js";

const code = `#include <iostream>
int foo(){return 1;}
int main(){std::cout<<"hi\\n"; return foo();}
`;

const res = await tracer.generateTrace(code, "cpp");
console.log("OK", { steps: res.totalSteps, functions: res.functions.length });

