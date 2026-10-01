{-# LANGUAGE OverloadedStrings #-}

module Zither.Tree (Tree, Node(..), importTree, exportTree, observe, compileEdit) where

import Control.Monad (unless, when)
import Data.Aeson
import Data.Aeson.Types (Parser, parseEither)
import Data.Aeson.Key (fromText)
import qualified Data.Aeson.KeyMap as K
import qualified Data.Set as Set
import Data.Text (Text)
import qualified Data.Text as T
import Zither.Operations (operations, operationId)

-- Keep the source JSON. A projection is useful to the model, but cannot reconstruct CAD.
data Tree = Tree Object Text [Node] deriving (Eq, Show)
data Node = Node { source :: Object, identifier :: Text, children :: [Node] } deriving (Eq, Show)

instance FromJSON Node where
  parseJSON = withObject "feature" $ \o -> do
    fid <- o .: "featureId" >>= nonempty
    nested <- o .:? "subFeatures" .!= []
    parameters <- o .:? "parameters" .!= [] :: Parser [Object]
    ids <- traverse (\p -> p .: "parameterId" >>= nonempty) parameters
    unique "Duplicate parameter ID" ids
    pure (Node o fid nested)

nonempty :: Text -> Parser Text
nonempty value = if T.null value then fail "Empty identifier" else pure value

unique :: Ord a => String -> [a] -> Parser ()
unique message xs = unless (length xs == Set.size (Set.fromList xs)) (fail message)

importTree :: Value -> Either String Tree
importTree = parseEither $ withObject "feature list" $ \o -> do
  revision <- o .: "sourceMicroversion" >>= nonempty
  _ <- (o .: "serializationVersion" >>= nonempty) :: Parser Text
  complete <- o .:? "isComplete" .!= True
  skew <- o .:? "microversionSkew" .!= False
  unless (complete && not skew) (fail "Read the complete feature tree at one microversion")
  nodes <- o .: "features"
  unique "Duplicate feature ID" (concatMap ids nodes)
  pure (Tree o revision nodes)
  where ids node = identifier node : concatMap ids (children node)

exportTree :: Tree -> Value
exportTree (Tree raw _ _) = Object raw

-- History order and subfeature ownership are known. Geometry queries stay opaque;
-- feature order alone does not establish a dependency edge.
observe :: Tree -> Value
observe (Tree raw revision nodes) = object
  [ "microversion" .= revision, "features" .= map view nodes ]
  where
    states = case K.lookup "featureStates" raw of Just (Object s) -> s; _ -> K.empty
    view node = object
      [ "id" .= identifier node, "name" .= field "name" node, "type" .= field "featureType" node
      , "namespace" .= field "namespace" node, "suppressed" .= maybe (Bool False) id (K.lookup "suppressed" (source node))
      , "parameters" .= parameters node, "children" .= map view (children node)
      , "state" .= K.lookup (fromText (identifier node)) states ]
    field key node = maybe (String "") id (K.lookup key (source node))
    parameters node = case K.lookup "parameters" (source node) of
      Just (Array ps) -> [object ["id" .= pid, "expression" .= expression] | Object p <- foldr (:) [] ps,
        Just (String pid) <- [K.lookup "parameterId" p], Just (String expression) <- [K.lookup "expression" p]]
      _ -> []

-- One feature per plan: one regeneration, no pretend transaction across multiple writes.
-- Only existing expression leaves can change. Unknown fields, query trees, sketch
-- constraints, and subfeatures travel with the owning feature exactly as read.
compileEdit :: Tree -> Text -> Text -> [(Text, Text)] -> Either String Value
compileEdit (Tree raw revision nodes) expected fid edits = parseEither (const compile) Null
  where
    compile = do
      unless (revision == expected) (fail "The Part Studio changed. Read its features again before editing.")
      rollback <- raw .:? "rollbackIndex" .!= (-1 :: Int)
      -- Requests use -1 for the end; responses can return the concrete history length.
      unless (rollback == -1 || rollback == length nodes) (fail "Move the rollback bar to the end before editing")
      when (null edits || length edits > 64) (fail "Supply between 1 and 64 expression edits")
      unique "Duplicate edit to the same parameter" (map fst edits)
      node <- case filter ((== fid) . identifier) nodes of
        [n] -> pure n
        _ -> fail "Choose a top-level feature from the current tree; subfeatures cannot be edited independently"
      parameters <- source node .:? "parameters" .!= [] :: Parser [Object]
      changes <- traverse (change parameters) edits
      let replace p = case K.lookup "parameterId" p of
            Just (String pid) -> maybe p (\expression -> K.insert "expression" (String expression) p) (lookup pid edits)
            _ -> p
          feature = K.insert "parameters" (toJSON (map replace parameters)) (source node)
          metadata = K.filterWithKey (\key _ -> key `elem` ["sourceMicroversion", "serializationVersion", "libraryVersion"]) raw
          body = K.insert "btType" (String "BTFeatureDefinitionCall-1406") $
            K.insert "feature" (Object feature) (K.insert "rejectMicroversionSkew" (Bool True) metadata)
      unless (any ((== "updatePartStudioFeature") . operationId) operations) (fail "Missing documented update operation")
      pure $ object ["version" .= (1 :: Int), "operationId" .= ("updatePartStudioFeature" :: Text),
        "featureId" .= fid, "body" .= body, "changes" .= changes, "changed" .= (feature /= source node)]
    change parameters (pid, expression) = do
      when (T.null (T.strip expression) || T.length expression > 500) (fail "Invalid expression")
      parameter <- case filter ((== Just (String pid)) . K.lookup "parameterId") parameters of
        [p] -> pure p
        _ -> fail "Choose an existing expression parameter"
      before <- parameter .: "expression" :: Parser Text
      pure $ object ["parameterId" .= pid, "before" .= before, "after" .= expression]
