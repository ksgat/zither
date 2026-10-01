{-# LANGUAGE OverloadedStrings #-}

module Main (main) where

import Control.Monad (unless)
import Data.Aeson
import qualified Data.Aeson.KeyMap as K
import Data.Either (isLeft)
import qualified Data.Text as T
import System.Exit (die)
import Zither.Tree
import Zither.Operations (operations, operationId)

assert :: String -> Bool -> IO ()
assert label condition = unless condition (die label)

field :: Key -> Value -> Value
field key (Object o) = maybe Null id (K.lookup key o)
field _ _ = Null

set :: Key -> Value -> Value -> Value
set key value (Object o) = Object (K.insert key value o)
set _ _ value = value

items :: Value -> [Value]
items (Array xs) = foldr (:) [] xs
items _ = []

right :: Either String a -> IO a
right = either die pure

main :: IO ()
main = do
  raw <- eitherDecodeFileStrict' "test/fixtures/partstudio.json" >>= right
  tree <- right (importTree raw)
  assert "lossless tree import" (exportTree tree == raw)
  let original = items (field "features" raw) !! 1
      parameters = items (field "parameters" original)
      expected = set "parameters" (toJSON (set "expression" "25 mm" (head parameters) : tail parameters)) original
  plan <- right (compileEdit tree "m1" "extrude1" [("depth", "25 mm")])
  assert "only requested leaf changed" (field "feature" (field "body" plan) == expected)
  assert "skew rejected at Onshape" (field "rejectMicroversionSkew" (field "body" plan) == Bool True)
  assert "library version preserved" (field "libraryVersion" (field "body" plan) == field "libraryVersion" raw)
  assert "input not mutated" (exportTree tree == raw)
  assert "nested ownership visible" (length (items (field "children" (items (field "features" (observe tree)) !! 1))) == 1)
  noop <- right (compileEdit tree "m1" "extrude1" [("depth", "10 mm")])
  assert "no-op detected" (field "changed" noop == Bool False)
  batch <- right (compileEdit tree "m1" "extrude1" [("depth", "20 mm"), ("draftAngle", "4 deg")])
  assert "batch one feature" (length (items (field "changes" batch)) == 2)
  assert "stale tree rejected" (isLeft (compileEdit tree "old" "extrude1" [("depth", "25 mm")]))
  assert "unknown target rejected" (isLeft (compileEdit tree "m1" "missing" [("depth", "25 mm")]))
  assert "subfeature is not an independent edit" (isLeft (compileEdit tree "m1" "owned1" [("amount", "25 mm")]))
  assert "query replacement rejected" (isLeft (compileEdit tree "m1" "extrude1" [("entities", "25 mm")]))
  assert "duplicate changes rejected" (isLeft (compileEdit tree "m1" "extrude1" [("depth", "20 mm"), ("depth", "30 mm")]))
  assert "no empty edits" (isLeft (compileEdit tree "m1" "extrude1" []))
  assert "bounded expression" (isLeft (compileEdit tree "m1" "extrude1" [("depth", T.replicate 501 "x")]))
  assert "partial trees rejected" (isLeft (importTree (set "isComplete" (Bool False) raw)))
  assert "skewed trees rejected" (isLeft (importTree (set "microversionSkew" (Bool True) raw)))
  rolled <- right (importTree (set "rollbackIndex" (Number 1) raw))
  assert "rolled back edit rejected" (isLeft (compileEdit rolled "m1" "extrude1" [("depth", "20 mm")]))
  end <- right (importTree (set "rollbackIndex" (Number (-1)) raw))
  _ <- right (compileEdit end "m1" "extrude1" [("depth", "20 mm")])
  let features = items (field "features" raw)
  assert "duplicate IDs rejected" (isLeft (importTree (set "features" (toJSON (head features : features)) raw)))
  assert "catalog covers all operations" (length operations == 302 && any ((== "getAssemblyDefinition") . operationId) operations)
  putStrLn "Haskell tree preservation and sparse edit tests passed."
