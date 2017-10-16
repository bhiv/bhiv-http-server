### Configuration:

  routes:

## User defined routes names

    <route-name>:
      method: ('get' : default | 'post' | 'put' | 'delete' | 'options' | ...)
      path: { String } (e.g. /user/:id)
      - handler: { Bhiv.Fqn }
      - output:  { type }
      merge: (*)

## Special routes names

    error-404:
      handler: { Bhiv.Fqn }
      glue: (*)
