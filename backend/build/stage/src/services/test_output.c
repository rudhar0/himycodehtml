
#include <stdio.h>
int main() {
    int i;
    __trace_declare(i, int, 4);
    i = 0;
    __trace_assign(i, i, 4);
    __trace_loop_start(0, "for", "int i = 0", "i < 3", "i++", 4);
    for (; i < 3; ) {
      __trace_loop_condition(0, (i < 3) ? 1 : 0, 4);
      if (!(i < 3)) { __trace_loop_end(0, 4); break; }
      __trace_loop_body_start(0, 4);
        __trace_condition_eval(0, "i == 1", (i == 1) ? 1 : 0, 5);
        if (i == 1) {
          __trace_block_enter(3, 5);
          __trace_branch_taken(0, "if", 5);
          printf("if-braceless\n");
          __trace_block_exit(3, 6);
        } else {
          __trace_block_enter(3, 7);
          __trace_branch_taken(0, "else", 7);
          printf("else-braceless\n");
          __trace_block_exit(3, 8);
        }

        __trace_block_enter(3, 10);
        __trace_condition_eval(1, "i == 2", (i == 2) ? 1 : 0, 10);
        if (i == 2) {
          __trace_branch_taken(1, "if", 10);
            printf("if-braced\n");
            __trace_control_flow("output_flush", 11);
            __trace_output_flush(11);
        } else {
          __trace_block_exit(3, 12);
          __trace_block_enter(4, 12);
          __trace_branch_taken(1, "else", 12);
            printf("else-braced\n");
            __trace_control_flow("output_flush", 13);
            __trace_output_flush(13);
        }

        printf("after-if %d\n", i);
        __trace_control_flow("output_flush", 16);
        __trace_output_flush(16);
      i++;
      __trace_assign(i, i, 4);
      __trace_loop_iteration_end(0, 4);
    }
    __trace_loop_end(0, 17);
    {
      __auto_type __rv_17 = (0);
      __trace_assign(__rv_17, __rv_17, 18);
      __trace_return(__rv_17, "auto", "0", 18);
      return __rv_17;
    }
}
