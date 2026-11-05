export const sqlExample = `database commerce

table customers {
  id bigint pk
  email varchar(255) required unique
}

table orders {
  id bigint pk
  customer_id bigint required ref customers.id
  index orders_customer (customer_id)
}

table order_items {
  id bigint pk
  order_id bigint required ref orders.id ondelete cascade
  product_id bigint required ref products.id
  quantity integer required default 1
  index unique order_product (order_id, product_id)
}

table products {
  id bigint pk
  name varchar(255) required
  price numeric(12,2) required
}
`;

export const mongoExample = `database commerce

collection customers {
  _id objectId pk
  email string required unique
}

collection orders {
  _id objectId pk
  customer_id objectId required ref customers._id
  items array required
  metadata object
  index orders_customer (customer_id)
}
`;

export const syntaxHelp = [
  'database NAME',
  'MySQL: database NAME charset utf8mb4 collate utf8mb4_0900_ai_ci (both options are optional, collate follows charset)',
  'table NAME { ... } for SQL or collection NAME { ... } for MongoDB',
  'One FIELD TYPE per line, with optional pk, required, unique, ref ENTITY.FIELD',
  'SQL fields can add default JSON_LITERAL or default now, and ondelete cascade|restrict|set_null|no_action after a reference',
  'SQL entities can declare primary (field_a, field_b)',
  'Declare index [unique] NAME (field_a, field_b) inside an entity',
  'MongoDB uses BSON types and _id as the primary key. Its references are diagram metadata.',
  'Use // or # for full-line comments.',
].join('\n');
