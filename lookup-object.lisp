(defmethod lookup-object-in-swank (id)
  (multiple-value-bind (object foundp) (swank:lookup-presented-object id)
    (declare (ignore foundp))
    (cond
      ((typep object 'string) "string")
      ((typep object 'character) "character")

      ((typep object 'number) "number")
      
      ((typep object 'boolean) "boolean")
      
      ((typep object 'symbol) "symbol")

      ((typep object 'list) "list")
      ((typep object 'array) "array")
      ((typep object 'hash-table) "hash-table")

      ;; Anything else; perhaps a class
      (T "other"))))
