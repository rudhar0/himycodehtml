int main(){
  int a=0;
  if(a)
    a++;
  else if(a<2)
    a+=2;
  else
    a+=3;
  for(int i=0;i<3;i++)
    a+=i;
  while(a<20)
    a++;
  do
    a--;
  while(a>5);
}
