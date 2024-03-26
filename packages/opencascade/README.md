# JupyterCad custom Open-Cascade build

## How to debug Open-Cascade exceptions?

### Update the build.yml file to allow raising exceptions (disabled by default for optimization)

You will need to do the following changes to the `build.yml` file:

- Add the following symbols:

```yml
- symbol: Standard_Failure
- symbol: OCJS
```

- Add the following Cpp code:

```yml
additionalCppCode: |
  class OCJS {
  public:
    static Standard_Failure* getStandard_FailureData(intptr_t exceptionPtr) {
      return reinterpret_cast<Standard_Failure*>(exceptionPtr);
    }
  };
```

- Remove the `"-fexceptions"` and the `"-sDISABLE_EXCEPTION_CATCHING=1"` build options.

### Update your code as following:

```javascript
try {
  // Failing OCC code
} catch (e) {
  if (typeof e === 'number') {
    const exceptionData = oc.OCJS.getStandard_FailureData(e);
    console.log(
      `That didn't work because: ${exceptionData.GetMessageString()}`
    );
  } else {
    console.log('Unkown error');
  }
}
```
