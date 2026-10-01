{-# LANGUAGE OverloadedStrings #-}

module Zither.Catalog (describeOperation) where

import Data.Aeson
import Data.Aeson.Types (parseEither)
import qualified Data.Aeson.Key as Key
import qualified Data.Aeson.KeyMap as K
import Data.Text (Text)
import qualified Data.Text as T
import Zither.Operations

-- Documentation lookup, never arbitrary HTTP execution. Follow schema references
-- once, including cycles, so callers receive the operation's complete vocabulary.
describeOperation :: Value -> Text -> Either String Value
describeOperation spec name = case filter ((== name) . operationId) operations of
  [op] -> parseEither (withObject "OpenAPI" $ \root -> do
    paths <- root .: "paths"
    item <- paths .: Key.fromText (path op)
    definition <- item .: Key.fromText (T.toLower (method op))
    components <- root .: "components"
    schemas <- components .: "schemas"
    pure $ object ["operationId" .= name, "method" .= method op, "path" .= path op,
      "definition" .= (definition :: Value), "schemas" .= reachable schemas [definition] K.empty]) spec
  _ -> Left "Unknown operation ID"
  where
    reachable _ [] seen = seen
    reachable schemas (value:rest) seen =
      let names = filter (\key -> not (K.member key seen)) (refs value)
          found = K.fromList [(key, v) | key <- names, Just v <- [K.lookup key schemas]]
      in reachable schemas (K.elems found ++ rest) (K.union seen found)
    -- Discriminator mappings use schema URI strings without a $ref wrapper.
    refs (Object o) = concatMap refs (K.elems o)
    refs (Array values) = concatMap refs values
    refs (String ref) | Just name' <- T.stripPrefix "#/components/schemas/" ref = [Key.fromText name']
    refs _ = []
