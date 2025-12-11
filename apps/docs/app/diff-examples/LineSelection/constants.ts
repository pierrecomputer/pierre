import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';
import type { PreloadMultiFileDiffOptions } from '@pierre/diffs/ssr';

export const LINE_SELECTION_EXAMPLE: PreloadMultiFileDiffOptions<undefined> = {
  oldFile: {
    name: 'vector.cpp',
    contents: `#include <iostream>
#include <vector>
#include <algorithm>
#include <stdexcept>

template <typename T>
class Vector {
private:
    T* data;
    size_t capacity;
    size_t length;
    static const size_t INITIAL_CAPACITY = 8;

public:
    Vector() : data(nullptr), capacity(0), length(0) {
        reserve(INITIAL_CAPACITY);
    }

    ~Vector() {
        delete[] data;
        data = nullptr;
    }

    void push_back(const T& value) {
        if (length >= capacity) {
            reserve(capacity * 2);
        }
        data[length++] = value;
    }

    T& operator[](size_t index) {
        if (index >= length) {
            throw std::out_of_range("Index out of bounds");
        }
        return data[index];
    }

    size_t size() const { return length; }
    bool empty() const { return length == 0; }

    void reserve(size_t newCapacity) {
        if (newCapacity <= capacity) return;
        T* newData = new T[newCapacity];
        for (size_t i = 0; i < length; i++) {
            newData[i] = data[i];
        }
        delete[] data;
        data = newData;
        capacity = newCapacity;
    }
};
`,
  },
  newFile: {
    name: 'vector.cpp',
    contents: `#include <iostream>
#include <vector>
#include <algorithm>
#include <stdexcept>

template <typename T>
class Vector {
private:
    T* data;
    size_t capacity;
    size_t length;
    static const size_t INITIAL_CAPACITY = 8;

public:
    Vector() : data(nullptr), capacity(0), length(0) {
        reserve(INITIAL_CAPACITY);
    }

    ~Vector() {
        delete[] data;
    }

    void push_back(const T& value) {
        if (length >= capacity) {
            size_t newCap = capacity == 0 ? 1 : capacity * 2;
            reserve(newCap);
        }
        data[length++] = value;
    }

    T& operator[](size_t index) {
        return data[index];
    }

    void clear() {
        length = 0;
    }

    T& front() { return data[0]; }
    T& back() { return data[length - 1]; }

    size_t size() const { return length; }
    bool empty() const { return length == 0; }

    void reserve(size_t newCapacity) {
        if (newCapacity <= capacity) return;
        T* newData = new T[newCapacity];
        for (size_t i = 0; i < length; i++) {
            newData[i] = data[i];
        }
        delete[] data;
        data = newData;
        capacity = newCapacity;
    }
};
`,
  },
  options: {
    theme: { dark: 'pierre-dark', light: 'pierre-light' },
    themeType: 'dark',
    diffStyle: 'split',
    disableBackground: false,
    unsafeCSS: CustomScrollbarCSS,
    enableLineSelection: true,
  },
};
