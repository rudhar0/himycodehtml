#include <stdio.h>

/* -------- FUNCTION WITH LOOP + CONDITION -------- */
int sumEven(int *arr, int size) {
    int i;
    int sum = 0;

    for (i = 0; i < size; i++) {
        if (arr[i] % 2 == 0) {
            sum = sum + arr[i];
        }
    }

    return sum;
}

/* -------- FUNCTION WITH POINTER UPDATE -------- */
void updateValue(int *p) {
    if (*p < 5) {
        int k = 0;
        while (k < 2) {
            *p = *p + 1;
            k++;
        }
    }
}

int main() {
    /* -------- VARIABLES -------- */
    int x = 3;
    int y = 0;

    /* -------- ARRAY -------- */
    int arr[5] = {1, 2, 3, 4, 5};

    /* -------- POINTER -------- */
    int *px = &x;

    /* -------- FUNCTION CALL (ARRAY + LOOP + CONDITION) -------- */
    y = sumEven(arr, 5);
    printf("sumEven = %d\n", y);

    /* -------- FOR LOOP + CONDITION + FUNCTION CALL -------- */
    int i;
    for (i = 0; i < 3; i++) {
        if (x < 5) {
            updateValue(px);
        }
    }

    /* -------- WHILE LOOP WITH NESTED FOR -------- */
    int j = 0;
    while (j < 2) {
        int z = 0;

        for (z = 0; z < 2; z++) {
            if (z == j) {
                printf("z == j (%d)\n", z);
            }
        }
        j++;
    }

    /* -------- DO-WHILE INSIDE CONDITION -------- */
    int t = 0;
    if (x > 0) {
        do {
            t++;
            printf("t = %d\n", t);
        } while (t < 2);
    }

    return 0;
}
