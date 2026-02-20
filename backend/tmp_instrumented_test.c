#include <stdio.h>
#include "trace.h"
int main() {
    int x;
    __trace_declare(x, int, 5);
    x = 1;
    __trace_assign(x, x, 5);
    __trace_condition_eval(0, "x > 0", (x > 0) ? 1 : 0, 6);
    if (x > 0) {
      __trace_branch_taken(0, "if", 6);
        printf("Hi\n");
        __trace_control_flow("output_flush", 7);
        __trace_output_flush(7);
    } else {
      __trace_condition_eval(1, "x < 0", (x < 0) ? 1 : 0, 8);
      if (x < 0) {
        __trace_branch_taken(1, "else-if", 8);
        printf("Low\n");
        __trace_control_flow("output_flush", 9);
        __trace_output_flush(9);
    } else {
      __trace_branch_taken(2, "else", 10);
        printf("Bye\n");
        __trace_control_flow("output_flush", 11);
        __trace_output_flush(11);
    }
    }
    __trace_control_flow("output_flush", 13);
    __trace_output_flush(13);
    __trace_return(0, "auto", "", 13);
    return 0;
}
