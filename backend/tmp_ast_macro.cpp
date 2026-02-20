#define CHECK(x) if(x) x++
int main(){
  int a=0;
  CHECK(a);
  if(a)
    a++;
}
