class GccService {
  async compile(code, language = 'c', flags = []) {
    console.error("Frontend GCC service should not be used directly. Use the backend API.");
    return { success: false, stderr: "Frontend compilation not supported" };
  }
}

export const gccService = new GccService();