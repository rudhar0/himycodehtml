#include "trace.h"
int main(){
  int x = 1;
  __trace_assign(x, x, 3);
  return 0;
}
