// backend/src/cpp/trace.h
#pragma once

#include <cstdio>
#include <cstdlib>

#ifdef _WIN32
#ifdef __cplusplus
extern "C" {
#endif

void trace_var_int_loc(const char* name, int value, const char* file, int line);
void trace_var_long_loc(const char* name, long long value, const char* file, int line);
void trace_var_double_loc(const char* name, double value, const char* file, int line);
void trace_var_ptr_loc(const char* name, void* value, const char* file, int line);
void trace_var_str_loc(const char* name, const char* value, const char* file, int line);

void trace_var_int(const char* name, int value);
void trace_var_long(const char* name, long long value);
void trace_var_double(const char* name, double value);
void trace_var_ptr(const char* name, void* value);
void trace_var_str(const char* name, const char* value);

void __trace_declare_loc(const char* name, const char* type, void* address, const char* file, int line);
void __trace_assign_loc(const char* name, long long value, const char* file, int line);

void __trace_array_create_loc(const char* name, const char* baseType, void* address,
                               int dim1, int dim2, int dim3, bool isStack,
                               const char* file, int line);
void __trace_array_init_loc(const char* name, void* values, int count,
                             const char* file, int line);
void __trace_array_init_string_loc(const char* name, const char* str_literal,
                                    const char* file, int line);
void __trace_array_index_assign_loc(const char* name, int idx1, int idx2, int idx3,
                                     long long value, const char* file, int line);

void __trace_pointer_alias_loc(const char* name, void* aliasedAddress, bool decayedFromArray,
                                const char* file, int line);
void __trace_pointer_deref_write_loc(const char* ptrName, long long value,
                                      const char* file, int line);
void __trace_pointer_heap_init_loc(const char* ptrName, void* heapAddr,
                                    const char* file, int line);

void __trace_control_flow_loc(const char* controlType, const char* file, int line);
void __trace_loop_start_loc(int loopId, const char* loopType, const char* file, int line);
void __trace_loop_body_start_loc(int loopId, const char* file, int line);
void __trace_loop_iteration_end_loc(int loopId, const char* file, int line);
void __trace_loop_end_loc(int loopId, const char* file, int line);
void __trace_loop_condition_loc(int loopId, int result, const char* file, int line);
void __trace_return_loc(long long value, const char* returnType, const char* destinationSymbol, const char* file, int line);
void __trace_block_enter_loc(int blockDepth, const char* file, int line);
void __trace_block_exit_loc(int blockDepth, const char* file, int line);
void __trace_output_flush_loc(const char* file, int line);
void __trace_condition_eval_loc(int conditionId, const char* expression, int result, const char* file, int line);
void __trace_branch_taken_loc(int conditionId, const char* branchType, const char* file, int line);

#ifdef __cplusplus
}
#endif

#define TRACE_INT(var)    trace_var_int_loc(#var, (int)(var), __FILE__, __LINE__)
#define TRACE_LONG(var)   trace_var_long_loc(#var, (long long)(var), __FILE__, __LINE__)
#define TRACE_DOUBLE(var) trace_var_double_loc(#var, (double)(var), __FILE__, __LINE__)
#define TRACE_PTR(var)    trace_var_ptr_loc(#var, (void*)(var), __FILE__, __LINE__)
#define TRACE_STR(var)    trace_var_str_loc(#var, (const char*)(var), __FILE__, __LINE__)
#define TRACE_VAR(var)    TRACE_INT(var)

#define __trace_declare(name, type, line) \
    __trace_declare_loc(#name, #type, (void*)&(name), __FILE__, line)
#define __trace_assign(name, value, line) \
    __trace_assign_loc(#name, (long long)(value), __FILE__, line)
#define __trace_array_create(name, baseType, dim1, dim2, dim3, line) \
    __trace_array_create_loc(#name, #baseType, (void*)(name), dim1, dim2, dim3, true, __FILE__, line)
#define __trace_array_init(name, values, count, line) \
    __trace_array_init_loc(#name, (void*)(values), count, __FILE__, line)
#define __trace_array_init_string(name, str_literal, line) \
    __trace_array_init_string_loc(#name, str_literal, __FILE__, line)
#define __trace_array_index_assign_1d(name, idx, value, line) \
    __trace_array_index_assign_loc(#name, idx, -1, -1, (long long)(value), __FILE__, line)
#define __trace_array_index_assign_2d(name, idx1, idx2, value, line) \
    __trace_array_index_assign_loc(#name, idx1, idx2, -1, (long long)(value), __FILE__, line)
#define __trace_array_index_assign_3d(name, idx1, idx2, idx3, value, line) \
    __trace_array_index_assign_loc(#name, idx1, idx2, idx3, (long long)(value), __FILE__, line)
#define __trace_pointer_alias(name, value, decayed, line) \
    __trace_pointer_alias_loc(#name, (void*)(value), decayed, __FILE__, line)
#define __trace_pointer_deref_write(ptrName, value, line) \
    __trace_pointer_deref_write_loc(#ptrName, (long long)(value), __FILE__, line)
#define __trace_pointer_heap_init(ptrName, heapAddr, line) \
    __trace_pointer_heap_init_loc(#ptrName, heapAddr, __FILE__, line)
#define __trace_control_flow(controlType, line) \
    __trace_control_flow_loc(controlType, __FILE__, line)
#define __trace_loop_start(loopId, loopType, line) \
    __trace_loop_start_loc(loopId, loopType, __FILE__, line)
#define __trace_loop_body_start(loopId, line) \
    __trace_loop_body_start_loc(loopId, __FILE__, line)
#define __trace_loop_iteration_end(loopId, line) \
    __trace_loop_iteration_end_loc(loopId, __FILE__, line)
#define __trace_loop_end(loopId, line) \
    __trace_loop_end_loc(loopId, __FILE__, line)
#define __trace_loop_condition(loopId, result, line) \
    __trace_loop_condition_loc(loopId, result, __FILE__, line)
#define __trace_return(value, returnType, destinationSymbol, line) \
    __trace_return_loc((long long)(value), returnType, destinationSymbol, __FILE__, line)
#define __trace_block_enter(blockDepth, line) \
    __trace_block_enter_loc(blockDepth, __FILE__, line)
#define __trace_block_exit(blockDepth, line) \
    __trace_block_exit_loc(blockDepth, __FILE__, line)
#define __trace_output_flush(line) \
    __trace_output_flush_loc(__FILE__, line)
#define __trace_condition_eval(conditionId, expression, result, line) \
    __trace_condition_eval_loc(conditionId, expression, result, __FILE__, line)
#define __trace_branch_taken(conditionId, branchType, line) \
    __trace_branch_taken_loc(conditionId, branchType, __FILE__, line)

#else

#ifdef __cplusplus
extern "C" {
#endif

void trace_var_int_loc(const char* name, int value, const char* file, int line);
void trace_var_long_loc(const char* name, long long value, const char* file, int line);
void trace_var_double_loc(const char* name, double value, const char* file, int line);
void trace_var_ptr_loc(const char* name, void* value, const char* file, int line);
void trace_var_str_loc(const char* name, const char* value, const char* file, int line);

void trace_var_int(const char* name, int value);
void trace_var_long(const char* name, long long value);
void trace_var_double(const char* name, double value);
void trace_var_ptr(const char* name, void* value);
void trace_var_str(const char* name, const char* value);

void __trace_declare_loc(const char* name, const char* type, void* address, const char* file, int line);
void __trace_assign_loc(const char* name, long long value, const char* file, int line);

void __trace_array_create_loc(const char* name, const char* baseType, void* address,
                               int dim1, int dim2, int dim3, bool isStack,
                               const char* file, int line);
void __trace_array_init_loc(const char* name, void* values, int count,
                             const char* file, int line);
void __trace_array_init_string_loc(const char* name, const char* str_literal,
                                    const char* file, int line);
void __trace_array_index_assign_loc(const char* name, int idx1, int idx2, int idx3,
                                     long long value, const char* file, int line);

void __trace_pointer_alias_loc(const char* name, void* aliasedAddress, bool decayedFromArray,
                                const char* file, int line);
void __trace_pointer_deref_write_loc(const char* ptrName, long long value,
                                      const char* file, int line);
void __trace_pointer_heap_init_loc(const char* ptrName, void* heapAddr,
                                    const char* file, int line);

void __trace_control_flow_loc(const char* controlType, const char* file, int line);
void __trace_loop_start_loc(int loopId, const char* loopType, const char* file, int line);
void __trace_loop_body_start_loc(int loopId, const char* file, int line);
void __trace_loop_iteration_end_loc(int loopId, const char* file, int line);
void __trace_loop_end_loc(int loopId, const char* file, int line);
void __trace_loop_condition_loc(int loopId, int result, const char* file, int line);
void __trace_return_loc(long long value, const char* returnType, const char* destinationSymbol, const char* file, int line);
void __trace_block_enter_loc(int blockDepth, const char* file, int line);
void __trace_block_exit_loc(int blockDepth, const char* file, int line);
void __trace_output_flush_loc(const char* file, int line);
void __trace_condition_eval_loc(int conditionId, const char* expression, int result, const char* file, int line);
void __trace_branch_taken_loc(int conditionId, const char* branchType, const char* file, int line);

#ifdef __cplusplus
}
#endif

#define TRACE_INT(var)    trace_var_int_loc(#var, (int)(var), __FILE__, __LINE__)
#define TRACE_LONG(var)   trace_var_long_loc(#var, (long long)(var), __FILE__, __LINE__)
#define TRACE_DOUBLE(var) trace_var_double_loc(#var, (double)(var), __FILE__, __LINE__)
#define TRACE_PTR(var)    trace_var_ptr_loc(#var, (void*)(var), __FILE__, __LINE__)
#define TRACE_STR(var)    trace_var_str_loc(#var, (const char*)(var), __FILE__, __LINE__)
#define TRACE_VAR(var)    TRACE_INT(var)

#define __trace_declare(name, type, line) \
    __trace_declare_loc(#name, #type, (void*)&(name), __FILE__, line)
#define __trace_assign(name, value, line) \
    __trace_assign_loc(#name, (long long)(value), __FILE__, line)
#define __trace_array_create(name, baseType, dim1, dim2, dim3, line) \
    __trace_array_create_loc(#name, #baseType, (void*)(name), dim1, dim2, dim3, true, __FILE__, line)
#define __trace_array_init(name, values, count, line) \
    __trace_array_init_loc(#name, (void*)(values), count, __FILE__, line)
#define __trace_array_init_string(name, str_literal, line) \
    __trace_array_init_string_loc(#name, str_literal, __FILE__, line)
#define __trace_array_index_assign_1d(name, idx, value, line) \
    __trace_array_index_assign_loc(#name, idx, -1, -1, (long long)(value), __FILE__, line)
#define __trace_array_index_assign_2d(name, idx1, idx2, value, line) \
    __trace_array_index_assign_loc(#name, idx1, idx2, -1, (long long)(value), __FILE__, line)
#define __trace_array_index_assign_3d(name, idx1, idx2, idx3, value, line) \
    __trace_array_index_assign_loc(#name, idx1, idx2, idx3, (long long)(value), __FILE__, line)
#define __trace_pointer_alias(name, value, decayed, line) \
    __trace_pointer_alias_loc(#name, (void*)(value), decayed, __FILE__, line)
#define __trace_pointer_deref_write(ptrName, value, line) \
    __trace_pointer_deref_write_loc(#ptrName, (long long)(value), __FILE__, line)
#define __trace_pointer_heap_init(ptrName, heapAddr, line) \
    __trace_pointer_heap_init_loc(#ptrName, heapAddr, __FILE__, line)
#define __trace_control_flow(controlType, line) \
    __trace_control_flow_loc(controlType, __FILE__, line)
#define __trace_loop_start(loopId, loopType, line) \
    __trace_loop_start_loc(loopId, loopType, __FILE__, line)
#define __trace_loop_body_start(loopId, line) \
    __trace_loop_body_start_loc(loopId, __FILE__, line)
#define __trace_loop_iteration_end(loopId, line) \
    __trace_loop_iteration_end_loc(loopId, __FILE__, line)
#define __trace_loop_end(loopId, line) \
    __trace_loop_end_loc(loopId, __FILE__, line)
#define __trace_loop_condition(loopId, result, line) \
    __trace_loop_condition_loc(loopId, result, __FILE__, line)
#define __trace_return(value, returnType, destinationSymbol, line) \
    __trace_return_loc((long long)(value), returnType, destinationSymbol, __FILE__, line)
#define __trace_block_enter(blockDepth, line) \
    __trace_block_enter_loc(blockDepth, __FILE__, line)
#define __trace_block_exit(blockDepth, line) \
    __trace_block_exit_loc(blockDepth, __FILE__, line)
#define __trace_output_flush(line) \
    __trace_output_flush_loc(__FILE__, line)
#define __trace_condition_eval(conditionId, expression, result, line) \
    __trace_condition_eval_loc(conditionId, expression, result, __FILE__, line)
#define __trace_branch_taken(conditionId, branchType, line) \
    __trace_branch_taken_loc(conditionId, branchType, __FILE__, line)

#endif