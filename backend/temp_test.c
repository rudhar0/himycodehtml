
#include <stdio.h>
void foo() {}
int main() {
    int i = 0;
    while(i < 3) {
        if (i % 2)
            foo();
        i++;
    }
    return 0;
}
