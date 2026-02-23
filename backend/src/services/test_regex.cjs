const funcPattern = /^\\s*(static\\s+)?(inline\\s+)?(const\\s+)?(?:(?:unsigned|signed|long|short)\\s+)*(void|int|long|float|double|char|bool|auto|short|size_t)\\s*\\**\\s*(\\w+)\\s*\\([^;]*$/;
const match = 'long int factorial(int n) {'.match(funcPattern);
console.log(match ? match[5] : 'null');
const multiPointer = 'void** myfunc(void* ptr) {'.match(funcPattern);
console.log(multiPointer ? multiPointer[5] : 'null');
const noSpace = 'int main(){'.match(funcPattern);
console.log(noSpace ? noSpace[5] : 'null');
