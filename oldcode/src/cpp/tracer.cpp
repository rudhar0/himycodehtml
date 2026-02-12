// backend/src/cpp/tracer.cpp
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <cstddef>
#include <algorithm>
#include <string>
#include <map>
#include <set>
#include <vector>

#ifdef _WIN32
    #include <windows.h>
#else
    #include <dlfcn.h>
    #include <cxxabi.h>
    #include <sys/time.h>
    #include <unistd.h>
    #include <mutex>
#endif

#include "trace.h"

static FILE* g_trace_file = nullptr;
static int g_depth = 0;
static unsigned long g_event_counter = 0;

#ifndef _WIN32
static std::mutex g_trace_mutex;
#endif

struct ArrayInfo {
    std::string name;
    std::string baseType;
    void* address;
    int dim1, dim2, dim3;
    bool isStack;
};

struct ArrayElementKey {
    std::string arrayName;
    int idx1, idx2, idx3;
    
    bool operator<(const ArrayElementKey& other) const {
        if (arrayName != other.arrayName) return arrayName < other.arrayName;
        if (idx1 != other.idx1) return idx1 < other.idx1;
        if (idx2 != other.idx2) return idx2 < other.idx2;
        return idx3 < other.idx3;
    }
};

struct PointerInfo {
    std::string pointerName;
    void* aliasedAddress;
    bool isHeap;
    void* heapAddress;
};

struct CallFrame {
    std::string functionName;
    std::map<std::string, PointerInfo> pointerAliases;
    std::vector<int> activeLoops;
    std::map<int, int> loopIterations;
};

static std::map<std::string, long long> g_variable_values;
static std::map<void*, ArrayInfo> g_array_registry;
static std::map<void*, std::string> g_address_to_name;
static std::map<ArrayElementKey, long long> g_array_element_values;
static std::set<std::string> g_tracked_functions;
static std::string g_current_function = "main";
static std::map<std::string, PointerInfo> g_pointer_registry;
static std::vector<CallFrame> g_call_stack;

static inline unsigned long get_timestamp_us() {
#ifdef _WIN32
    static LARGE_INTEGER freq{};
    static BOOL initialized = FALSE;
    if (!initialized) {
        QueryPerformanceFrequency(&freq);
        initialized = TRUE;
    }
    LARGE_INTEGER now;
    QueryPerformanceCounter(&now);
    return static_cast<unsigned long>((now.QuadPart * 1000000ULL) / freq.QuadPart);
#else
    struct timeval tv{};
    gettimeofday(&tv, nullptr);
    return static_cast<unsigned long>(tv.tv_sec * 1000000UL + tv.tv_usec);
#endif
}

static void lock_trace() {
#ifndef _WIN32
    g_trace_mutex.lock();
#endif
}

static void unlock_trace() {
#ifndef _WIN32
    g_trace_mutex.unlock();
#endif
}

static const char* demangle(const char* name) {
#ifndef _WIN32
    if (!name) return "unknown";
    int status = 0;
    char* real = abi::__cxa_demangle(name, nullptr, nullptr, &status);
    if (status == 0 && real) {
        static __thread char buffer[512];
        strncpy(buffer, real, sizeof(buffer) - 1);
        buffer[sizeof(buffer) - 1] = '\0';
        free(real);
        return buffer;
    }
    return name;
#else
    return name;
#endif
}

static std::string json_safe_path(const char* raw) {
    if (!raw) return "";
    std::string s(raw);
    std::replace(s.begin(), s.end(), '\\', '/');
    return s;
}

static std::string normalize_function_name(const char* name) {
    if (!name) return "unknown";
    std::string s(name);
    s.erase(std::remove(s.begin(), s.end(), '\r'), s.end());
    s.erase(std::remove(s.begin(), s.end(), '\n'), s.end());
    return s;
}

static void write_json_event(const char* type, void* addr,
                             const char* func_name, int depth,
                             const char* extra = nullptr) {
    lock_trace();

    if (!g_trace_file) { unlock_trace(); return; }

    if (g_event_counter > 0) fputs(",\n", g_trace_file);

    fprintf(g_trace_file,
            "  {\"id\":%lu,\"type\":\"%s\",\"addr\":\"%p\",\"func\":\"%s\",\"depth\":%d,\"ts\":%lu",
            g_event_counter++, type, addr,
            func_name ? func_name : "unknown",
            depth, get_timestamp_us());

    if (extra) fprintf(g_trace_file, ",%s", extra);
    fputs("}", g_trace_file);
    fflush(g_trace_file);
    fflush(stdout);

    unlock_trace();
}

static PointerInfo* findPointerInfo(const std::string& ptrName) {
    for (auto it = g_call_stack.rbegin(); it != g_call_stack.rend(); ++it) {
        auto pit = it->pointerAliases.find(ptrName);
        if (pit != it->pointerAliases.end()) {
            return &(pit->second);
        }
    }
    
    auto git = g_pointer_registry.find(ptrName);
    if (git != g_pointer_registry.end()) {
        return &(git->second);
    }
    
    return nullptr;
}

extern "C" void __trace_output_flush_loc(const char* file, int line) {
    fflush(stdout);
    fflush(stderr);
    fflush(g_trace_file);
}

extern "C" void __trace_condition_eval_loc(int conditionId, const char* expression, int result,
                                           const char* file, int line) {
    if (!g_trace_file) return;
    const std::string f = json_safe_path(file);
    char extra[512];
    snprintf(extra, sizeof(extra),
             "\"conditionId\":%d,\"expression\":\"%s\",\"result\":%d,\"file\":\"%s\",\"line\":%d",
             conditionId, expression, result, f.c_str(), line);
    write_json_event("condition_eval", nullptr, g_current_function.c_str(), g_depth, extra);
}

extern "C" void __trace_branch_taken_loc(int conditionId, const char* branchType,
                                         const char* file, int line) {
    if (!g_trace_file) return;
    const std::string f = json_safe_path(file);
    char extra[256];
    snprintf(extra, sizeof(extra),
             "\"conditionId\":%d,\"branchType\":\"%s\",\"file\":\"%s\",\"line\":%d",
             conditionId, branchType, f.c_str(), line);
    write_json_event("branch_taken", nullptr, g_current_function.c_str(), g_depth, extra);
}

extern "C" void __trace_array_create_loc(const char* name, const char* baseType,
                                         void* address, int dim1, int dim2, int dim3,
                                         bool isStack, const char* file, int line) {
    if (!g_trace_file) return;
    
    g_address_to_name[address] = name;

    const std::string f = json_safe_path(file);
    char extra[512];
    
    char dims[64];
    if (dim3 > 0) {
        snprintf(dims, sizeof(dims), "[%d,%d,%d]", dim1, dim2, dim3);
    } else if (dim2 > 0) {
        snprintf(dims, sizeof(dims), "[%d,%d]", dim1, dim2);
    } else {
        snprintf(dims, sizeof(dims), "[%d]", dim1);
    }
    
    snprintf(extra, sizeof(extra),
             "\"name\":\"%s\",\"baseType\":\"%s\",\"dimensions\":%s,\"isStack\":%s,\"file\":\"%s\",\"line\":%d",
             name, baseType, dims, isStack ? "true" : "false", f.c_str(), line);
    
    write_json_event("array_create", address, g_current_function.c_str(), g_depth, extra);
    
    ArrayInfo info;
    info.name = name;
    info.baseType = baseType;
    info.address = address;
    info.dim1 = dim1;
    info.dim2 = dim2;
    info.dim3 = dim3;
    info.isStack = isStack;
    
    g_array_registry[address] = info;
}

extern "C" void __trace_array_init_string_loc(const char* name, const char* str_literal,
                                               const char* file, int line) {
    if (!g_trace_file) return;
    
    const std::string f = json_safe_path(file);
    const int len = str_literal ? strlen(str_literal) : 0;
    
    for (int i = 0; i <= len; i++) {
        char c = (i < len) ? str_literal[i] : '\0';
        char extra[256];
        snprintf(extra, sizeof(extra),
                 "\"name\":\"%s\",\"indices\":[%d],\"value\":%d,\"char\":\"\\u%04x\",\"file\":\"%s\",\"line\":%d",
                 name, i, (int)c, (unsigned char)c, f.c_str(), line);
        
        write_json_event("array_index_assign", nullptr, g_current_function.c_str(), g_depth, extra);
        
        ArrayElementKey key;
        key.arrayName = name;
        key.idx1 = i;
        key.idx2 = -1;
        key.idx3 = -1;
        g_array_element_values[key] = (long long)c;
    }
}

extern "C" void __trace_array_init_loc(const char* name, void* values, int count,
                                       const char* file, int line) {
    if (!g_trace_file) return;
    
    const std::string f = json_safe_path(file);
    int* intValues = static_cast<int*>(values);
    
    for (int i = 0; i < count; i++) {
        char extra[256];
        snprintf(extra, sizeof(extra),
                 "\"name\":\"%s\",\"indices\":[%d],\"value\":%d,\"file\":\"%s\",\"line\":%d",
                 name, i, intValues[i], f.c_str(), line);
        
        write_json_event("array_index_assign", nullptr, g_current_function.c_str(), g_depth, extra);
        
        ArrayElementKey key;
        key.arrayName = name;
        key.idx1 = i;
        key.idx2 = -1;
        key.idx3 = -1;
        g_array_element_values[key] = (long long)intValues[i];
    }
}

extern "C" void __trace_array_index_assign_loc(const char* name, int idx1, int idx2, int idx3,
                                                long long value, const char* file, int line) {
    if (!g_trace_file) return;
    
    ArrayElementKey key;
    key.arrayName = name;
    key.idx1 = idx1;
    key.idx2 = idx2;
    key.idx3 = idx3;
    
    g_array_element_values[key] = value;
    
    const std::string f = json_safe_path(file);
    
    char indices[64];
    if (idx3 >= 0) {
        snprintf(indices, sizeof(indices), "[%d,%d,%d]", idx1, idx2, idx3);
    } else if (idx2 >= 0) {
        snprintf(indices, sizeof(indices), "[%d,%d]", idx1, idx2);
    } else {
        snprintf(indices, sizeof(indices), "[%d]", idx1);
    }
    
    char extra[512];
    snprintf(extra, sizeof(extra),
             "\"name\":\"%s\",\"indices\":%s,\"value\":%lld,\"file\":\"%s\",\"line\":%d",
             name, indices, value, f.c_str(), line);
    
    write_json_event("array_index_assign", nullptr, g_current_function.c_str(), g_depth, extra);
}

extern "C" void __trace_pointer_alias_loc(const char* name, void* aliasedAddress, bool decayedFromArray,
                                          const char* file, int line) {
    if (!g_trace_file) return;

    std::string aliasOfName = "unknown";
    if (g_address_to_name.count(aliasedAddress)) {
        aliasOfName = g_address_to_name[aliasedAddress];
    }
    
    const std::string f = json_safe_path(file);
    char extra[512];
    snprintf(extra, sizeof(extra),
             "\"name\":\"%s\",\"aliasOf\":\"%s\",\"aliasedAddress\":\"%p\",\"decayedFromArray\":%s,\"file\":\"%s\",\"line\":%d",
             name, aliasOfName.c_str(), aliasedAddress, decayedFromArray ? "true" : "false", f.c_str(), line);
    
    write_json_event("pointer_alias", aliasedAddress, g_current_function.c_str(), g_depth, extra);
    
    PointerInfo pinfo;
    pinfo.pointerName = name;
    pinfo.aliasedAddress = aliasedAddress;
    pinfo.isHeap = false;
    pinfo.heapAddress = nullptr;
    
    if (!g_call_stack.empty()) {
        g_call_stack.back().pointerAliases[name] = pinfo;
    } else {
        g_pointer_registry[name] = pinfo;
    }
}

extern "C" void __trace_pointer_deref_write_loc(const char* ptrName, long long value,
                                                const char* file, int line) {
    if (!g_trace_file) return;
    
    const std::string f = json_safe_path(file);

    PointerInfo* pinfo = findPointerInfo(ptrName);

    std::string targetName = "unknown";
    bool isHeap = false;
    void* targetAddress = nullptr;

    if (pinfo) {
        isHeap = pinfo->isHeap;
        targetAddress = pinfo->aliasedAddress;
        if (g_address_to_name.count(targetAddress)) {
            targetName = g_address_to_name[targetAddress];
        }
    }
    
    char extra[512];
    snprintf(extra, sizeof(extra),
             "\"pointerName\":\"%s\",\"value\":%lld,\"targetName\":\"%s\",\"isHeap\":%s,\"file\":\"%s\",\"line\":%d",
             ptrName, value, targetName.c_str(), isHeap ? "true" : "false", f.c_str(), line);
    write_json_event("pointer_deref_write", targetAddress, g_current_function.c_str(), g_depth, extra);
    
    if (isHeap) {
        char heap_extra[512];
        snprintf(heap_extra, sizeof(heap_extra),
                 "\"address\":\"%p\",\"value\":%lld,\"file\":\"%s\",\"line\":%d",
                 targetAddress, value, f.c_str(), line);
        write_json_event("heap_write", targetAddress, g_current_function.c_str(), g_depth, heap_extra);
    }
}

extern "C" void __trace_declare_loc(const char* name, const char* type, void* address,
                                    const char* file, int line) {
    if (!g_trace_file) return;

    g_address_to_name[address] = name;
    
    const std::string f = json_safe_path(file);
    char extra[256];
    snprintf(extra, sizeof(extra),
             "\"name\":\"%s\",\"varType\":\"%s\",\"value\":null,\"address\":\"%p\",\"file\":\"%s\",\"line\":%d",
             name, type, address, f.c_str(), line);
    write_json_event("declare", address, name, g_depth, extra);
}

extern "C" void __trace_assign_loc(const char* name, long long value,
                                   const char* file, int line) {
    if (!g_trace_file) return;
    
    g_variable_values[name] = value;
    
    const std::string f = json_safe_path(file);
    char extra[256];
    snprintf(extra, sizeof(extra),
             "\"name\":\"%s\",\"value\":%lld,\"file\":\"%s\",\"line\":%d",
             name, value, f.c_str(), line);
    write_json_event("assign", nullptr, name, g_depth, extra);
}

extern "C" void __trace_pointer_heap_init_loc(const char* ptrName, void* heapAddr,
                                               const char* file, int line) {
    if (!g_trace_file) return;
    
    PointerInfo pinfo;
    pinfo.pointerName = ptrName;
    pinfo.aliasedAddress = heapAddr;
    pinfo.isHeap = true;
    pinfo.heapAddress = heapAddr;
    
    if (!g_call_stack.empty()) {
        g_call_stack.back().pointerAliases[ptrName] = pinfo;
    }
    
    g_pointer_registry[ptrName] = pinfo;
}

extern "C" void __trace_control_flow_loc(const char* controlType, const char* file, int line) {
    if (!g_trace_file) return;
    const std::string f = json_safe_path(file);
    char extra[256];
    snprintf(extra, sizeof(extra),
             "\"controlType\":\"%s\",\"file\":\"%s\",\"line\":%d",
             controlType, f.c_str(), line);
    write_json_event("control_flow", nullptr, g_current_function.c_str(), g_depth, extra);
}

extern "C" void __trace_loop_start_loc(int loopId, const char* loopType, const char* file, int line) {
    if (!g_trace_file) return;
    
    if (!g_call_stack.empty()) {
        g_call_stack.back().activeLoops.push_back(loopId);
        g_call_stack.back().loopIterations[loopId] = 0;
    }
    
    const std::string f = json_safe_path(file);
    char extra[256];
    snprintf(extra, sizeof(extra),
             "\"loopId\":%d,\"loopType\":\"%s\",\"file\":\"%s\",\"line\":%d",
             loopId, loopType, f.c_str(), line);
    write_json_event("loop_start", nullptr, g_current_function.c_str(), g_depth, extra);
}

extern "C" void __trace_loop_body_start_loc(int loopId, const char* file, int line) {
    if (!g_trace_file) return;
    
    int iteration = 0;
    if (!g_call_stack.empty()) {
        iteration = ++g_call_stack.back().loopIterations[loopId];
    }
    
    const std::string f = json_safe_path(file);
    char extra[256];
    snprintf(extra, sizeof(extra),
             "\"loopId\":%d,\"iteration\":%d,\"file\":\"%s\",\"line\":%d",
             loopId, iteration, f.c_str(), line);
    write_json_event("loop_body_start", nullptr, g_current_function.c_str(), g_depth, extra);
}

extern "C" void __trace_loop_iteration_end_loc(int loopId, const char* file, int line) {
    if (!g_trace_file) return;
    
    int iteration = 0;
    if (!g_call_stack.empty()) {
        iteration = g_call_stack.back().loopIterations[loopId];
    }
    
    const std::string f = json_safe_path(file);
    char extra[256];
    snprintf(extra, sizeof(extra),
             "\"loopId\":%d,\"iteration\":%d,\"file\":\"%s\",\"line\":%d",
             loopId, iteration, f.c_str(), line);
    write_json_event("loop_iteration_end", nullptr, g_current_function.c_str(), g_depth, extra);
}

extern "C" void __trace_loop_end_loc(int loopId, const char* file, int line) {
    if (!g_trace_file) return;
    
    if (!g_call_stack.empty()) {
        auto& loops = g_call_stack.back().activeLoops;
        auto it = std::find(loops.begin(), loops.end(), loopId);
        if (it != loops.end()) {
            loops.erase(it);
        }
        g_call_stack.back().loopIterations.erase(loopId);
    }
    
    const std::string f = json_safe_path(file);
    char extra[256];
    snprintf(extra, sizeof(extra),
             "\"loopId\":%d,\"file\":\"%s\",\"line\":%d",
             loopId, f.c_str(), line);
    write_json_event("loop_end", nullptr, g_current_function.c_str(), g_depth, extra);
}

extern "C" void __trace_loop_condition_loc(int loopId, int result, const char* file, int line) {
    if (!g_trace_file) return;
    const std::string f = json_safe_path(file);
    char extra[256];
    snprintf(extra, sizeof(extra),
             "\"loopId\":%d,\"result\":%d,\"file\":\"%s\",\"line\":%d",
             loopId, result, f.c_str(), line);
    write_json_event("loop_condition", nullptr, g_current_function.c_str(), g_depth, extra);
}

extern "C" void __trace_return_loc(long long value, const char* returnType, 
                                    const char* destinationSymbol, const char* file, int line) {
    if (!g_trace_file) return;
    const std::string f = json_safe_path(file);
    char extra[512];
    
    if (destinationSymbol && destinationSymbol[0] != '\0') {
        snprintf(extra, sizeof(extra),
                 "\"value\":%lld,\"returnType\":\"%s\",\"destinationSymbol\":\"%s\",\"file\":\"%s\",\"line\":%d",
                 value, returnType ? returnType : "auto", destinationSymbol, f.c_str(), line);
    } else {
        snprintf(extra, sizeof(extra),
                 "\"value\":%lld,\"returnType\":\"%s\",\"file\":\"%s\",\"line\":%d",
                 value, returnType ? returnType : "auto", f.c_str(), line);
    }
    
    write_json_event("return", nullptr, g_current_function.c_str(), g_depth, extra);
}

extern "C" void __trace_block_enter_loc(int blockDepth, const char* file, int line) {
    if (!g_trace_file) return;
    const std::string f = json_safe_path(file);
    char extra[256];
    snprintf(extra, sizeof(extra),
             "\"blockDepth\":%d,\"file\":\"%s\",\"line\":%d",
             blockDepth, f.c_str(), line);
    write_json_event("block_enter", nullptr, g_current_function.c_str(), g_depth, extra);
}

extern "C" void __trace_block_exit_loc(int blockDepth, const char* file, int line) {
    if (!g_trace_file) return;
    const std::string f = json_safe_path(file);
    char extra[256];
    snprintf(extra, sizeof(extra),
             "\"blockDepth\":%d,\"file\":\"%s\",\"line\":%d",
             blockDepth, f.c_str(), line);
    write_json_event("block_exit", nullptr, g_current_function.c_str(), g_depth, extra);
}

extern "C" void trace_var_int_loc(const char* name, int value,
                                   const char* file, int line) {
    if (!g_trace_file) return;
    const std::string f = json_safe_path(file);
    char extra[256];
    snprintf(extra, sizeof(extra),
             "\"name\":\"%s\",\"value\":%d,\"type\":\"int\",\"file\":\"%s\",\"line\":%d",
             name, value, f.c_str(), line);
    write_json_event("var", nullptr, name, g_depth, extra);
}

extern "C" void trace_var_long_loc(const char* name, long long value,
                                    const char* file, int line) {
    if (!g_trace_file) return;
    const std::string f = json_safe_path(file);
    char extra[256];
    snprintf(extra, sizeof(extra),
             "\"name\":\"%s\",\"value\":%lld,\"type\":\"long\",\"file\":\"%s\",\"line\":%d",
             name, value, f.c_str(), line);
    write_json_event("var", nullptr, name, g_depth, extra);
}

extern "C" void trace_var_double_loc(const char* name, double value,
                                      const char* file, int line) {
    if (!g_trace_file) return;
    const std::string f = json_safe_path(file);
    char extra[256];
    snprintf(extra, sizeof(extra),
             "\"name\":\"%s\",\"value\":%f,\"type\":\"double\",\"file\":\"%s\",\"line\":%d",
             name, value, f.c_str(), line);
    write_json_event("var", nullptr, name, g_depth, extra);
}

extern "C" void trace_var_ptr_loc(const char* name, void* value,
                                  const char* file, int line) {
    if (!g_trace_file) return;
    const std::string f = json_safe_path(file);
    char extra[256];
    snprintf(extra, sizeof(extra),
             "\"name\":\"%s\",\"value\":\"%p\",\"type\":\"pointer\",\"file\":\"%s\",\"line\":%d",
             name, value, f.c_str(), line);
    write_json_event("var", nullptr, name, g_depth, extra);
}

extern "C" void trace_var_str_loc(const char* name, const char* value,
                                  const char* file, int line) {
    if (!g_trace_file) return;
    const std::string f = json_safe_path(file);
    char escaped[256];
    int j = 0;
    for (int i = 0; value && value[i] && i < 250; ++i) {
        if (value[i] == '"' || value[i] == '\\') escaped[j++] = '\\';
        escaped[j++] = value[i];
    }
    escaped[j] = '\0';
    char extra[512];
    snprintf(extra, sizeof(extra),
             "\"name\":\"%s\",\"value\":\"%s\",\"type\":\"string\",\"file\":\"%s\",\"line\":%d",
             name, escaped, f.c_str(), line);
    write_json_event("var", nullptr, name, g_depth, extra);
}

extern "C" void trace_var_int(const char* name, int value) {
    trace_var_int_loc(name, value, "unknown", 0);
}
extern "C" void trace_var_long(const char* name, long long value) {
    trace_var_long_loc(name, value, "unknown", 0);
}
extern "C" void trace_var_double(const char* name, double value) {
    trace_var_double_loc(name, value, "unknown", 0);
}
extern "C" void trace_var_ptr(const char* name, void* value) {
    trace_var_ptr_loc(name, value, "unknown", 0);
}
extern "C" void trace_var_str(const char* name, const char* value) {
    trace_var_str_loc(name, value, "unknown", 0);
}

extern "C" void __cyg_profile_func_enter(void* func, void* caller)
    __attribute__((no_instrument_function));
void __cyg_profile_func_enter(void* func, void* caller) {
    const char* func_name = "unknown";

#ifndef _WIN32
    Dl_info dlinfo{};
    if (dladdr(func, &dlinfo) && dlinfo.dli_sname) {
        func_name = demangle(dlinfo.dli_sname);
        
        if (strstr(func_name, "GLOBAL__sub") || 
            strstr(func_name, "_static_initialization_and_destruction")) {
            return;
        }
        
        if (dlinfo.dli_fname &&
            (strstr(dlinfo.dli_fname, "/usr/") ||
             strstr(dlinfo.dli_fname, "/lib/") ||
             strstr(dlinfo.dli_fname, "libc") ||
             strstr(dlinfo.dli_fname, "libstdc++"))) {
            return;
        }
    }
#endif

    std::string fn = normalize_function_name(func_name);
    g_tracked_functions.insert(fn);
    g_current_function = fn;
    
    CallFrame frame;
    frame.functionName = fn;
    
    if (!g_call_stack.empty()) {
        frame.pointerAliases = g_call_stack.back().pointerAliases;
    }
    
    g_call_stack.push_back(frame);
    
    char extra[256];
    snprintf(extra, sizeof(extra), "\"caller\":\"%p\"", caller);
    write_json_event("func_enter", func, func_name, g_depth++, extra);
}

extern "C" void __cyg_profile_func_exit(void* func, void* caller)
    __attribute__((no_instrument_function));
void __cyg_profile_func_exit(void* func, void* caller) {
    const char* func_name = "unknown";

#ifndef _WIN32
    Dl_info dlinfo{};
    if (dladdr(func, &dlinfo) && dlinfo.dli_sname) {
        func_name = demangle(dlinfo.dli_sname);
        
        if (strstr(func_name, "GLOBAL__sub") || 
            strstr(func_name, "_static_initialization_and_destruction")) {
            return;
        }
        
        if (dlinfo.dli_fname &&
            (strstr(dlinfo.dli_fname, "/usr/") ||
             strstr(dlinfo.dli_fname, "/lib/"))) {
            return;
        }
    }
#endif

    fflush(stdout);
    fflush(stderr);

    if (!g_call_stack.empty()) {
        auto& activeLoops = g_call_stack.back().activeLoops;
        while (!activeLoops.empty()) {
            int loopId = activeLoops.back();
            activeLoops.pop_back();
            
            char extra[128];
            snprintf(extra, sizeof(extra), "\"loopId\":%d,\"file\":\"unknown\",\"line\":0", loopId);
            write_json_event("loop_end", nullptr, g_current_function.c_str(), g_depth, extra);
        }
        
        g_call_stack.pop_back();
    }
    
    if (!g_call_stack.empty()) {
        g_current_function = g_call_stack.back().functionName;
    } else {
        g_current_function = "main";
    }

    write_json_event("func_exit", func, func_name, --g_depth);
}

void* operator new(std::size_t size) {
    void* ptr = std::malloc(size);
    if (ptr && g_trace_file) {
        char extra[128];
        snprintf(extra, sizeof(extra), "\"size\":%zu,\"isHeap\":true", size);
        write_json_event("heap_alloc", ptr, "operator new", g_depth, extra);
    }
    return ptr;
}

void* operator new[](std::size_t size) {
    void* ptr = std::malloc(size);
    if (ptr && g_trace_file) {
        char extra[128];
        snprintf(extra, sizeof(extra), "\"size\":%zu,\"isHeap\":true", size);
        write_json_event("heap_alloc", ptr, "operator new[]", g_depth, extra);
    }
    return ptr;
}

void operator delete(void* ptr) noexcept {
    if (ptr && g_trace_file) {
        write_json_event("heap_free", ptr, "operator delete", g_depth);
    }
    std::free(ptr);
}

void operator delete[](void* ptr) noexcept {
    if (ptr && g_trace_file) {
        write_json_event("heap_free", ptr, "operator delete[]", g_depth);
    }
    std::free(ptr);
}

#if !defined(_WIN32)
extern "C" {
    static void* (*real_malloc)(std::size_t) = nullptr;
    static void (*real_free)(void*) = nullptr;

    static void init_malloc_hooks() __attribute__((constructor));
    static void init_malloc_hooks() {
        real_malloc = (void*(*)(std::size_t))dlsym(RTLD_NEXT, "malloc");
        real_free   = (void(*)(void*))dlsym(RTLD_NEXT, "free");
    }

    void* malloc(std::size_t size) __attribute__((no_instrument_function));
    void* malloc(std::size_t size) {
        if (!real_malloc) init_malloc_hooks();
        void* ptr = real_malloc(size);
        if (ptr && g_trace_file) {
            char extra[128];
            snprintf(extra, sizeof(extra), "\"size\":%zu,\"isHeap\":true", size);
            write_json_event("heap_alloc", ptr, "malloc", g_depth, extra);
        }
        return ptr;
    }

    void free(void* ptr) __attribute__((no_instrument_function));
    void free(void* ptr) {
        if (!real_free) init_malloc_hooks();
        if (ptr && g_trace_file) {
            write_json_event("heap_free", ptr, "free", g_depth);
        }
        real_free(ptr);
    }
}
#endif

extern "C" void __attribute__((constructor)) init_tracer()
    __attribute__((no_instrument_function));
void init_tracer() {
    setvbuf(stdout, NULL, _IONBF, 0);
    setvbuf(stderr, NULL, _IONBF, 0);

    const char* trace_path = std::getenv("TRACE_OUTPUT");
    if (!trace_path) trace_path = "trace.json";

    g_trace_file = std::fopen(trace_path, "w");
    if (g_trace_file) {
        setvbuf(g_trace_file, NULL, _IONBF, 0);
        std::fprintf(g_trace_file,
                     "{\"version\":\"1.0\",\"functions\":[],\"events\":[\n");
        std::fflush(g_trace_file);
    }
}

extern "C" void __attribute__((destructor)) finish_tracer()
    __attribute__((no_instrument_function));
void finish_tracer() {
    fflush(stdout);
    fflush(stderr);
    
    if (g_trace_file) {
        std::fprintf(g_trace_file, "\n],\"tracked_functions\":[");
        bool first = true;
        for (const auto& fn : g_tracked_functions) {
            if (!first) std::fprintf(g_trace_file, ",");
            std::fprintf(g_trace_file, "\"%s\"", fn.c_str());
            first = false;
        }
        std::fprintf(g_trace_file, "],\"total_events\":%lu}\n", g_event_counter);
        std::fclose(g_trace_file);
        g_trace_file = nullptr;
    }
}