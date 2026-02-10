
#include <iostream>
#include <vector>

int main() {
  std::vector<int> v = {1, 2, 3};
  std::cout << "Hello from Clang 18.1.8" << std::endl;
  for (int i : v)
    std::cout << i << " ";
  std::cout << std::endl;
  return 0;
}
